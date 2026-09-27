import Fastify from 'fastify';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => {
  const prisma = {
    worker: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    user: {
      findUnique: vi.fn(),
      updateMany: vi.fn(),
      upsert: vi.fn(),
      delete: vi.fn(),
    },
    $transaction: vi.fn(),
  };
  const clerk = {
    users: {
      getUserList: vi.fn(),
      updateUserMetadata: vi.fn(),
    },
    invitations: {
      getInvitationList: vi.fn(),
      revokeInvitation: vi.fn(),
      createInvitation: vi.fn(),
    },
  };
  return { prisma, clerk };
});

vi.mock('../lib/prisma.js', () => ({ prisma: mocks.prisma }));
vi.mock('@clerk/clerk-sdk-node', () => ({
  createClerkClient: () => mocks.clerk,
}));

import { workersRoutes } from './workers.js';

const worker = {
  id: 'worker-1',
  userId: 'placeholder-1',
  firstName: 'Shai',
  lastName: 'Winograd',
  email: 'worker@example.com',
};

async function createApp() {
  const app = Fastify();
  await app.register(workersRoutes, { prefix: '/workers' });
  return app;
}

describe('POST /workers/:id/link-login', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.CLERK_SECRET_KEY = 'sk_test_worker_link';
    mocks.prisma.$transaction.mockImplementation(async (callback) => callback(mocks.prisma));
    mocks.prisma.user.delete.mockResolvedValue({});
    mocks.prisma.user.updateMany.mockResolvedValue({ count: 1 });
    mocks.prisma.user.upsert.mockResolvedValue({});
    mocks.prisma.worker.update.mockResolvedValue(worker);
    mocks.clerk.users.updateUserMetadata.mockResolvedValue({});
  });

  it('links an existing Clerk account instead of pretending to resend an invitation', async () => {
    mocks.prisma.worker.findUnique
      .mockResolvedValueOnce(worker)
      .mockResolvedValueOnce(worker)
      .mockResolvedValueOnce(null);
    mocks.prisma.user.findUnique
      .mockResolvedValueOnce(null)
      .mockResolvedValueOnce({ id: 'placeholder-1', role: 'WORKER' });
    mocks.clerk.users.getUserList.mockResolvedValue({
      data: [{
        id: 'clerk-user-1',
        firstName: 'Shai',
        lastName: 'Winograd',
        publicMetadata: {},
        emailAddresses: [{ emailAddress: 'worker@example.com' }],
      }],
    });

    const response = await (await createApp()).inject({
      method: 'POST',
      url: '/workers/worker-1/link-login',
      payload: { email: 'worker@example.com' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ linked: true, existingAccount: true });
    expect(mocks.clerk.invitations.createInvitation).not.toHaveBeenCalled();
    expect(mocks.prisma.worker.update).toHaveBeenCalledWith({
      where: { id: 'worker-1' },
      data: { userId: 'clerk-user-1', email: 'worker@example.com' },
    });
    expect(mocks.clerk.users.updateUserMetadata).toHaveBeenCalledWith('clerk-user-1', {
      publicMetadata: { role: 'WORKER' },
    });
  });

  it('revokes a pending invitation before sending a fresh one', async () => {
    mocks.prisma.worker.findUnique
      .mockResolvedValueOnce(worker)
      .mockResolvedValueOnce(worker);
    mocks.clerk.users.getUserList.mockResolvedValue({ data: [] });
    mocks.clerk.invitations.getInvitationList.mockResolvedValue({
      data: [
        { id: 'invite-1', emailAddress: 'worker@example.com' },
        { id: 'invite-other', emailAddress: 'other@example.com' },
      ],
    });
    mocks.clerk.invitations.revokeInvitation.mockResolvedValue({});
    mocks.clerk.invitations.createInvitation.mockResolvedValue({});

    const response = await (await createApp()).inject({
      method: 'POST',
      url: '/workers/worker-1/link-login',
      payload: { email: 'worker@example.com' },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ invited: true });
    expect(mocks.clerk.invitations.revokeInvitation).toHaveBeenCalledWith('invite-1');
    expect(mocks.clerk.invitations.revokeInvitation).not.toHaveBeenCalledWith('invite-other');
    expect(mocks.clerk.invitations.createInvitation).toHaveBeenCalledWith(
      expect.objectContaining({
        emailAddress: 'worker@example.com',
        publicMetadata: { role: 'WORKER' },
        ignoreExisting: false,
      }),
    );
  });
});
