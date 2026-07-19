import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { UserRole } from '@workforce/shared';

// Time-triggered tasks (spec §19, §20.2, §21, §12.3). Invoked by an external
// scheduler (a scheduled GitHub Action) on an hourly cadence. Protected by a
// shared secret; each task is idempotent via notification history so repeated
// runs never spam workers.

function israelHour(now: Date): number {
  return Number(
    new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jerusalem', hour: 'numeric', hour12: false }).format(now),
  );
}

async function getOwnerIds(): Promise<string[]> {
  const owners = await prisma.user.findMany({
    where: { role: { in: [UserRole.OWNER, UserRole.ADMIN] }, isActive: true },
    select: { id: true },
  });
  return owners.map((o) => o.id);
}

// End of the calendar day AFTER the given date — the end-of-shift form deadline (§21).
function endOfNextDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + 2, 0, 0, 0);
}

function heDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

async function hasRecentNotification(userId: string, type: string, sinceMs: number, shiftId?: string): Promise<boolean> {
  const since = new Date(Date.now() - sinceMs);
  const and: any[] = [{ data: { path: ['type'], equals: type } }];
  if (shiftId) and.push({ data: { path: ['shiftId'], equals: shiftId } });
  const found = await prisma.notification.findFirst({
    where: { userId, sentAt: { gte: since }, AND: and },
    select: { id: true },
  });
  return Boolean(found);
}

// §20.2 — auto clock-out workers still clocked in well past their scheduled end.
async function runAutoClockOut(now: Date): Promise<number> {
  const graceSetting = await prisma.appSetting.findUnique({ where: { key: 'AUTO_CLOCK_OUT_GRACE_MINUTES' } });
  const graceMinutes = Number(graceSetting?.value ?? 15);
  const cutoff = new Date(now.getTime() - graceMinutes * 60_000);

  const stuck = await prisma.shift.findMany({
    where: { attendanceStatus: 'CLOCKED_IN', actualStart: { not: null }, actualEnd: null, scheduledEnd: { lt: cutoff } },
    include: { worker: { select: { userId: true } }, job: { select: { date: true } } },
  });

  const ownerIds = stuck.length ? await getOwnerIds() : [];
  for (const s of stuck) {
    const start = s.actualStart!.getTime();
    const end = s.scheduledEnd.getTime();
    const hours = Math.max(0, (end - start) / 3_600_000);
    await prisma.shift.update({
      where: { id: s.id },
      data: {
        actualEnd: s.scheduledEnd,
        attendanceStatus: 'AUTO_CLOCKED_OUT',
        clockOutMethod: 'AUTO_CLOCK_OUT',
        approvedHours: hours.toFixed(2),
        requiresReview: true,
      },
    });
    await prisma.notification.create({
      data: {
        userId: s.worker.userId,
        title: 'יציאה אוטומטית מהמשמרת',
        body: `סיימת אוטומטית את המשמרת בתאריך ${heDate(s.job.date)}. בעל/ת העסק יבדוק/תבדוק את השעות.`,
        data: { type: 'AUTO_CLOCK_OUT', shiftId: s.id } as any,
      },
    });
    if (ownerIds.length) {
      await prisma.notification.createMany({
        data: ownerIds.map((userId) => ({
          userId,
          title: 'יציאה אוטומטית – נדרשת בדיקה',
          body: `בוצעה יציאה אוטומטית ממשמרת בתאריך ${heDate(s.job.date)}. יש לבדוק ולאשר את הנוכחות.`,
          data: { type: 'AUTO_CLOCK_OUT_REVIEW', shiftId: s.id } as any,
        })),
      });
    }
  }
  return stuck.length;
}

// §21 — remind workers (every 3h) to submit missing end-of-shift forms while the
// edit window is open; flag overdue forms to the owner once the window closes.
async function runFormReminders(now: Date): Promise<{ reminded: number; overdue: number }> {
  const candidates = await prisma.shift.findMany({
    where: {
      formStatus: 'NOT_SUBMITTED',
      attendanceStatus: { in: ['CLOCKED_OUT', 'CORRECTED', 'AUTO_CLOCKED_OUT'] },
      actualEnd: { not: null },
    },
    include: { worker: { select: { userId: true } }, job: { select: { date: true } } },
  });

  let reminded = 0;
  let overdue = 0;
  const ownerIds = candidates.length ? await getOwnerIds() : [];

  for (const s of candidates) {
    const deadline = endOfNextDay(s.actualEnd ?? s.job.date);
    if (now <= deadline) {
      // Window open → remind the worker at most once per 3 hours.
      if (!(await hasRecentNotification(s.worker.userId, 'FORM_REMINDER', 3 * 3_600_000, s.id))) {
        await prisma.notification.create({
          data: {
            userId: s.worker.userId,
            title: 'תזכורת: טופס סיום משמרת',
            body: `נותר למלא את טופס סיום המשמרת לעבודה בתאריך ${heDate(s.job.date)}.`,
            data: { type: 'FORM_REMINDER', shiftId: s.id } as any,
          },
        });
        reminded += 1;
      }
    } else {
      // Window closed → the form is overdue; notify owners once.
      const alreadyFlagged = ownerIds.length
        ? await hasRecentNotification(ownerIds[0], 'FORM_OVERDUE', 365 * 24 * 3_600_000, s.id)
        : true;
      if (!alreadyFlagged && ownerIds.length) {
        await prisma.notification.createMany({
          data: ownerIds.map((userId) => ({
            userId,
            title: 'טופס סיום חסר (באיחור)',
            body: `לא הוגש טופס סיום למשמרת בתאריך ${heDate(s.job.date)}.`,
            data: { type: 'FORM_OVERDUE', shiftId: s.id } as any,
          })),
        });
        overdue += 1;
      }
    }
  }
  return { reminded, overdue };
}

// §19 / §12.3 — one consolidated 19:00 reminder per worker for assignments still
// awaiting their approval. Repeats daily until resolved.
async function runDailyApprovalReminders(): Promise<number> {
  const pending = await prisma.shift.findMany({
    where: { joinRequestStatus: 'AWAITING_WORKER' },
    include: {
      worker: { select: { userId: true } },
      job: { select: { date: true } },
    },
  });

  const byWorker = new Map<string, { count: number; dates: string[] }>();
  for (const s of pending) {
    const entry = byWorker.get(s.worker.userId) ?? { count: 0, dates: [] };
    entry.count += 1;
    entry.dates.push(heDate(s.job.date));
    byWorker.set(s.worker.userId, entry);
  }

  let sent = 0;
  for (const [userId, info] of byWorker) {
    // Once per day (guard against multiple runs within the 19:00 hour).
    if (await hasRecentNotification(userId, 'DAILY_APPROVAL_REMINDER', 12 * 3_600_000)) continue;
    await prisma.notification.create({
      data: {
        userId,
        title: 'עבודות ממתינות לאישורך',
        body: `יש לך ${info.count} עבודות שממתינות לאישור (${info.dates.join(', ')}). יש לאשר או לדחות כל אחת.`,
        data: { type: 'DAILY_APPROVAL_REMINDER', count: info.count } as any,
      },
    });
    sent += 1;
  }
  return sent;
}

export async function schedulerRoutes(app: FastifyInstance) {
  app.post('/run', async (req, reply) => {
    const secret = process.env.SCHEDULER_SECRET;
    if (!secret) return reply.status(503).send({ error: 'Scheduler not configured' });
    if (req.headers['x-scheduler-secret'] !== secret) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const now = new Date();
    const autoClockedOut = await runAutoClockOut(now);
    const forms = await runFormReminders(now);
    // Daily approval reminders fire only during the 19:00 hour (Israel).
    const dailyReminders = israelHour(now) === 19 ? await runDailyApprovalReminders() : 0;

    return {
      ranAt: now.toISOString(),
      autoClockedOut,
      formReminders: forms.reminded,
      overdueForms: forms.overdue,
      dailyApprovalReminders: dailyReminders,
    };
  });
}
