import { FastifyInstance } from 'fastify';
import { prisma } from '../lib/prisma.js';
import { authenticate, requireAnyRole } from '../middleware/auth.js';
import { Expo } from 'expo-server-sdk';

const expo = new Expo({ accessToken: process.env.EXPO_ACCESS_TOKEN });

export async function notificationsRoutes(app: FastifyInstance) {
  // Get my notifications
  app.get('/mine', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    return prisma.notification.findMany({
      where: { userId: user.id },
      orderBy: { sentAt: 'desc' },
      take: 50,
    });
  });

  // Mark as read
  app.post('/:id/read', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const { id } = req.params as { id: string };
    await prisma.notification.update({ where: { id }, data: { isRead: true, readAt: new Date() } });
    return { success: true };
  });

  // Mark all as read
  app.post('/read-all', { preHandler: [authenticate, requireAnyRole] }, async (req, reply) => {
    const user = (req as any).user;
    await prisma.notification.updateMany({
      where: { userId: user.id, isRead: false },
      data: { isRead: true, readAt: new Date() },
    });
    return { success: true };
  });
}

/**
 * Send a push notification to one worker.
 * Call this from other services (not a public route).
 */
export async function sendPushToWorker(workerId: string, title: string, body: string, data?: object) {
  const worker = await prisma.worker.findUnique({ where: { id: workerId } });
  if (!worker?.expoPushToken) return;

  if (!Expo.isExpoPushToken(worker.expoPushToken)) return;

  await expo.sendPushNotificationsAsync([
    { to: worker.expoPushToken, sound: 'default', title, body, data: data as Record<string, unknown> | undefined },
  ]);

  // Store in DB
  await prisma.notification.create({
    data: { userId: worker.userId, title, body, data: (data ?? null) as any },
  });
}
