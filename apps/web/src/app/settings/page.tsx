'use client';

import { useEffect, useMemo, useState } from 'react';
import { Lock, Save, ShieldCheck, SlidersHorizontal, UserCog } from 'lucide-react';
import { api } from '../../lib/api';

type AppRole = 'owner' | 'operations_admin' | 'finance_admin';

type AppSettingRow = { key: string; value: string };

function toBool(value: string | undefined, fallback = false) {
  if (value === undefined) return fallback;
  return value === 'true';
}

function toNumber(value: string | undefined, fallback: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export default function SettingsPage() {
  const [rolePreview, setRolePreview] = useState<AppRole>('owner');
  const [defaultRadius, setDefaultRadius] = useState(500);
  const [graceMinutes, setGraceMinutes] = useState(12);
  const [caseMatchDays, setCaseMatchDays] = useState(60);
  const [vatEnabled, setVatEnabled] = useState(true);
  const [vatRate, setVatRate] = useState(18);
  const [showWorkerPayments, setShowWorkerPayments] = useState(false);
  const [monthLockRequiresOwner, setMonthLockRequiresOwner] = useState(true);
  const [settingsLoading, setSettingsLoading] = useState(true);
  const [settingsSaving, setSettingsSaving] = useState(false);
  const [monthYear, setMonthYear] = useState('2026-07');
  const [monthStatus, setMonthStatus] = useState<{ isClosed: boolean; closedAt: string | null } | null>(null);
  const [monthCloseNote, setMonthCloseNote] = useState('');
  const [monthStatusLoading, setMonthStatusLoading] = useState(false);
  const [message, setMessage] = useState('');

  const isOwner = rolePreview === 'owner';
  const hasFinanceAccess = rolePreview === 'owner' || rolePreview === 'finance_admin';

  const settingsByKey = useMemo(
    () => new Map<string, string>(),
    [],
  );

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setSettingsLoading(true);
      try {
        const response = await api.get<AppSettingRow[]>('/settings');
        if (cancelled) return;
        response.data.forEach((row) => settingsByKey.set(row.key, row.value));
        setDefaultRadius(toNumber(settingsByKey.get('defaultRadiusMeters'), 500));
        setGraceMinutes(toNumber(settingsByKey.get('attendanceGraceMinutes'), 12));
        setCaseMatchDays(toNumber(settingsByKey.get('caseMatchDays'), 60));
        setVatEnabled(toBool(settingsByKey.get('vatEnabled'), true));
        setVatRate(toNumber(settingsByKey.get('vatRate'), 18));
        setShowWorkerPayments(toBool(settingsByKey.get('showWorkerPayments'), false));
        setMonthLockRequiresOwner(toBool(settingsByKey.get('monthLockRequiresOwner'), true));
      } catch {
        if (!cancelled) setMessage('לא ניתן לטעון את הגדרות המערכת כרגע.');
      } finally {
        if (!cancelled) setSettingsLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [settingsByKey]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setMonthStatusLoading(true);
      try {
        const [year, month] = monthYear.split('-');
        const response = await api.get('/reports/month-status', { params: { month, year } });
        if (!cancelled) {
          setMonthStatus({ isClosed: Boolean(response.data.isClosed), closedAt: response.data.closedAt ?? null });
        }
      } catch {
        if (!cancelled) setMonthStatus(null);
      } finally {
        if (!cancelled) setMonthStatusLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [monthYear]);

  const saveSettings = async () => {
    if (defaultRadius < 100 || defaultRadius > 2000) {
      setMessage('רדיוס ברירת מחדל חייב להיות בין 100 ל-2000 מטר.');
      return;
    }
    if (graceMinutes < 5 || graceMinutes > 30) {
      setMessage('זמן חסד חייב להיות בין 5 ל-30 דקות.');
      return;
    }
    if (caseMatchDays < 0 || caseMatchDays > 180) {
      setMessage('טווח התאמת תיק חייב להיות בין 0 ל-180 ימים.');
      return;
    }
    if (vatEnabled && (vatRate < 0 || vatRate > 30)) {
      setMessage('אחוז מע״מ חייב להיות בין 0 ל-30.');
      return;
    }

    setSettingsSaving(true);
    try {
      await Promise.all([
        api.patch('/settings/defaultRadiusMeters', { value: String(defaultRadius) }),
        api.patch('/settings/attendanceGraceMinutes', { value: String(graceMinutes) }),
        api.patch('/settings/caseMatchDays', { value: String(caseMatchDays) }),
        api.patch('/settings/vatEnabled', { value: String(vatEnabled) }),
        api.patch('/settings/vatRate', { value: String(vatRate) }),
        api.patch('/settings/showWorkerPayments', { value: String(showWorkerPayments) }),
        api.patch('/settings/monthLockRequiresOwner', { value: String(monthLockRequiresOwner) }),
      ]);
      setMessage('ההגדרות נשמרו בהצלחה.');
    } catch {
      setMessage('שמירת ההגדרות נכשלה.');
    } finally {
      setSettingsSaving(false);
    }
  };

  const closeMonth = async () => {
    const [year, month] = monthYear.split('-');
    try {
      await api.post('/reports/month-close', {
        month: Number(month),
        year: Number(year),
        notes: monthCloseNote.trim() || undefined,
      });
      setMonthStatus({ isClosed: true, closedAt: new Date().toISOString() });
      setMessage('החודש נסגר בהצלחה.');
    } catch {
      setMessage('לא ניתן לסגור את החודש כרגע.');
    }
  };

  const reopenMonth = async () => {
    const [year, month] = monthYear.split('-');
    try {
      await api.post('/reports/month-reopen', { month: Number(month), year: Number(year) });
      setMonthStatus({ isClosed: false, closedAt: null });
      setMessage('החודש נפתח מחדש בהצלחה.');
    } catch {
      setMessage('לא ניתן לפתוח את החודש כרגע.');
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 mb-1">הגדרות מערכת</h1>
        <p className="text-sm text-gray-500">ניהול הרשאות, הגדרות נוכחות, חוקים פיננסיים, וחוקי סגירת חודש.</p>
      </div>

      <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm">
        <div className="flex items-center gap-2 mb-2">
          <UserCog className="w-4 h-4 text-gray-500" />
          <h2 className="text-lg font-semibold">תצוגת הרשאות</h2>
        </div>
        <p className="text-xs text-gray-500 mb-3">לצורך בדיקה מה כל תפקיד יכול לראות ולערוך.</p>
        <select
          value={rolePreview}
          onChange={(event) => setRolePreview(event.target.value as AppRole)}
          className="rounded-xl border border-gray-300 px-3 py-2 text-sm"
        >
          <option value="owner">בעלים</option>
          <option value="operations_admin">אדמין תפעול</option>
          <option value="finance_admin">אדמין פיננסי</option>
        </select>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
          <div className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-gray-500" />
            <h2 className="text-lg font-semibold">הגדרות תפעול</h2>
          </div>

          <label className="block text-sm text-gray-700">
            רדיוס מיקום ברירת מחדל (מטרים)
            <input type="number" value={defaultRadius} onChange={(event) => setDefaultRadius(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
          </label>

          <label className="block text-sm text-gray-700">
            זמן חסד לפני סיום אוטומטי (דקות)
            <input type="number" value={graceMinutes} onChange={(event) => setGraceMinutes(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
          </label>

          <label className="block text-sm text-gray-700">
            כלל התאמת תיק אוטומטי (ימים)
            <input type="number" value={caseMatchDays} onChange={(event) => setCaseMatchDays(Number(event.target.value))} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm" />
          </label>
        </article>

        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-gray-500" />
            <h2 className="text-lg font-semibold">הגדרות פיננסיות</h2>
          </div>

          {!hasFinanceAccess ? (
            <div className="rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-800 inline-flex items-center gap-2">
              <Lock className="w-4 h-4" />
              אין הרשאת צפייה/עריכה להגדרות פיננסיות בתפקיד זה.
            </div>
          ) : (
            <>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={vatEnabled} onChange={(event) => setVatEnabled(event.target.checked)} />
                מע״מ פעיל
              </label>
              <label className="block text-sm text-gray-700">
                אחוז מע״מ
                <input type="number" value={vatRate} onChange={(event) => setVatRate(Number(event.target.value))} disabled={!vatEnabled} className="mt-1 w-full rounded-xl border border-gray-300 px-3 py-2 text-sm disabled:bg-gray-100" />
              </label>
              <label className="inline-flex items-center gap-2 text-sm text-gray-700">
                <input type="checkbox" checked={showWorkerPayments} onChange={(event) => setShowWorkerPayments(event.target.checked)} />
                לאפשר לעובדות לצפות בסיכום תשלומים אישי
              </label>
            </>
          )}
        </article>
      </section>

      <section className="grid gap-4 lg:grid-cols-2">
        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
          <h2 className="text-lg font-semibold">סגירת חודש והרשאות רגישות</h2>
          <label className="inline-flex items-center gap-2 text-sm text-gray-700">
            <input
              type="checkbox"
              checked={monthLockRequiresOwner}
              onChange={(event) => setMonthLockRequiresOwner(event.target.checked)}
              disabled={!isOwner}
            />
            רק בעלים יכול לסגור/לפתוח חודש
          </label>

          <div className="grid gap-2 md:grid-cols-2">
            <input type="month" value={monthYear} onChange={(event) => setMonthYear(event.target.value)} className="rounded-xl border border-gray-300 px-3 py-2 text-sm" />
            <input value={monthCloseNote} onChange={(event) => setMonthCloseNote(event.target.value)} placeholder="הערת סגירת חודש" className="rounded-xl border border-gray-300 px-3 py-2 text-sm" />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button type="button" onClick={() => void closeMonth()} className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700">
              <Save className="w-4 h-4" />
              סגירת חודש
            </button>
            <button type="button" onClick={() => void reopenMonth()} className="inline-flex items-center gap-2 rounded-lg border border-gray-300 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-50">
              <Lock className="w-4 h-4" />
              פתיחת חודש מחדש
            </button>
            {monthStatusLoading ? <span className="text-xs text-gray-500">טוען סטטוס חודש...</span> : null}
          </div>

          <div className="rounded-xl border border-gray-200 bg-gray-50 px-3 py-2 text-sm text-gray-700">
            {monthStatus?.isClosed ? `החודש סגור${monthStatus.closedAt ? ` מאז ${new Date(monthStatus.closedAt).toLocaleDateString('he-IL')}` : ''}` : 'החודש פתוח'}
          </div>
        </article>

        <article className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm space-y-3">
          <h2 className="text-lg font-semibold">מצב שמירה</h2>
          <p className="text-sm text-gray-500">הגדרות נשמרות לשרת, והחודש הנבחר נשלט דרך דוחות ניהול.</p>
          <button
            type="button"
            onClick={() => void saveSettings()}
            disabled={settingsSaving || settingsLoading}
            className="inline-flex items-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-700 disabled:opacity-50"
          >
            <Save className="w-4 h-4" />
            {settingsSaving ? 'שומר...' : 'שמירת הגדרות'}
          </button>
        </article>
      </section>

      {message ? <div className="rounded-xl border border-blue-200 bg-blue-50 px-3 py-2 text-sm text-blue-700">{message}</div> : null}
    </div>
  );
}
