/**
 * Authorization boundary tests for the auth middleware. Clerk and prisma are
 * mocked so these run as fast unit tests in CI (no DB / no network). They assert
 * the security-critical behavior: unknown authenticated users are blocked with
 * 403 and never provisioned, known roles are preserved, and role guards deny
 * owner/worker endpoints to unauthorized users.
 */
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { UserRole } from '@workforce/shared';

const verifyToken = vi.fn();
const getUser = vi.fn();
const updateUserMetadata = vi.fn();
vi.mock('@clerk/clerk-sdk-node', () => ({
  createClerkClient: () => ({ verifyToken, users: { getUser, updateUserMetadata } }),
}));

const prismaUser = { findUnique: vi.fn(), upsert: vi.fn(), update: vi.fn(), delete: vi.fn() };
const prismaWorker = { findUnique: vi.fn(), update: vi.fn() };
vi.mock('../lib/prisma.js', () => ({ prisma: { user: prismaUser, worker: prismaWorker } }));

type Auth = typeof import('./auth.js');
let authenticate: Auth['authenticate'];
let requireOwner: Auth['requireOwner'];
let requireAdmin: Auth['requireAdmin'];
let requireAnyRole: Auth['requireAnyRole'];
let resetDeniedLog: () => void;

beforeAll(async () => {
  process.env.ENABLE_API_AUTH = 'true';
  ({ authenticate, requireOwner, requireAdmin, requireAnyRole } = await import('./auth.js'));
  ({ __resetAuthorizationDeniedLog: resetDeniedLog } = await import('../lib/authorize.js'));
});

function makeReply() {
  return {
    statusCode: 0 as number,
    body: undefined as unknown,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    send(payload: unknown) {
      this.body = payload;
      return this;
    },
  };
}

function makeReq(token = 'tok') {
  return {
    headers: { authorization: `Bearer ${token}` },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  } as any;
}

beforeEach(() => {
  vi.clearAllMocks();
  resetDeniedLog();
});

describe('authenticate — provisioning authorization', () => {
  it('blocks an unknown authenticated user with 403 and never creates a profile', async () => {
    verifyToken.mockResolvedValue({ sub: 'unknown-1' });
    prismaUser.findUnique.mockResolvedValue(null); // no existing user
    getUser.mockResolvedValue({
      emailAddresses: [{ emailAddress: 'stranger@example.com' }],
      firstName: 'S',
      lastName: 'T',
      publicMetadata: {}, // no role
    });
    prismaWorker.findUnique.mockResolvedValue(null); // no pre-registered worker

    const req = makeReq();
    const reply = makeReply();
    await authenticate(req, reply as any);

    expect(reply.statusCode).toBe(403);
    expect(prismaUser.upsert).not.toHaveBeenCalled();
    expect(prismaWorker.update).not.toHaveBeenCalled();
    expect(req.user).toBeUndefined();
  });

  it('missing metadata never resolves to OWNER', async () => {
    verifyToken.mockResolvedValue({ sub: 'unknown-2' });
    prismaUser.findUnique.mockResolvedValue(null);
    getUser.mockResolvedValue({ emailAddresses: [{ emailAddress: 'nobody@example.com' }], publicMetadata: {} });
    prismaWorker.findUnique.mockResolvedValue(null);

    const reply = makeReply();
    await authenticate(makeReq(), reply as any);

    expect(reply.statusCode).toBe(403);
    expect(prismaUser.upsert).not.toHaveBeenCalled();
  });

  it('provisions a pre-registered worker as WORKER', async () => {
    verifyToken.mockResolvedValue({ sub: 'worker-1' });
    prismaUser.findUnique.mockResolvedValue(null);
    getUser.mockResolvedValue({
      emailAddresses: [{ emailAddress: 'worker@example.com' }],
      firstName: 'W',
      lastName: 'K',
      publicMetadata: {},
    });
    prismaWorker.findUnique.mockResolvedValue({ id: 'w1', userId: 'worker-1' });
    prismaUser.upsert.mockResolvedValue({ id: 'worker-1', role: UserRole.WORKER, isActive: true });
    updateUserMetadata.mockResolvedValue(undefined);

    const req = makeReq();
    const reply = makeReply();
    await authenticate(req, reply as any);

    expect(reply.statusCode).toBe(0); // no error sent
    expect(prismaUser.upsert).toHaveBeenCalledTimes(1);
    expect(prismaUser.upsert.mock.calls[0][0].create.role).toBe(UserRole.WORKER);
    expect(req.user.role).toBe(UserRole.WORKER);
  });

  it('provisions an explicitly invited admin as ADMIN only', async () => {
    verifyToken.mockResolvedValue({ sub: 'admin-1' });
    prismaUser.findUnique.mockResolvedValue(null);
    getUser.mockResolvedValue({
      emailAddresses: [{ emailAddress: 'admin@example.com' }],
      publicMetadata: { role: UserRole.ADMIN },
    });
    prismaWorker.findUnique.mockResolvedValue(null);
    prismaUser.upsert.mockResolvedValue({ id: 'admin-1', role: UserRole.ADMIN, isActive: true });

    const req = makeReq();
    const reply = makeReply();
    await authenticate(req, reply as any);

    expect(prismaUser.upsert.mock.calls[0][0].create.role).toBe(UserRole.ADMIN);
    expect(req.user.role).toBe(UserRole.ADMIN);
  });

  it('keeps an existing OWNER working (role read fresh from the DB)', async () => {
    verifyToken.mockResolvedValue({ sub: 'owner-1' });
    prismaUser.findUnique.mockResolvedValue({ id: 'owner-1', role: UserRole.OWNER, isActive: true });

    const req = makeReq();
    const reply = makeReply();
    await authenticate(req, reply as any);

    expect(getUser).not.toHaveBeenCalled(); // existing user → no re-provisioning
    expect(req.user.role).toBe(UserRole.OWNER);
    expect(reply.statusCode).toBe(0);
  });

  it('re-evaluates existing sessions each request: a deactivated account is denied', async () => {
    verifyToken.mockResolvedValue({ sub: 'stale-1' });
    prismaUser.findUnique.mockResolvedValue({ id: 'stale-1', role: UserRole.OWNER, isActive: false });

    const req = makeReq();
    const reply = makeReply();
    await authenticate(req, reply as any);

    expect(reply.statusCode).toBe(401);
    expect(req.user).toBeUndefined();
  });
});

describe('role guards', () => {
  it('denies owner endpoints to an unauthorized (no-user) request', async () => {
    const req = { user: undefined } as any;
    const reply = makeReply();
    await requireOwner(req, reply as any);
    expect(reply.statusCode).toBe(403);
  });

  it('denies worker endpoints to an unauthorized (no-user) request', async () => {
    const req = { user: undefined } as any;
    const reply = makeReply();
    await requireAnyRole(req, reply as any);
    expect(reply.statusCode).toBe(403);
  });

  it('denies owner endpoints to a WORKER', async () => {
    const req = { user: { role: UserRole.WORKER } } as any;
    const reply = makeReply();
    await requireOwner(req, reply as any);
    expect(reply.statusCode).toBe(403);
  });

  it('allows an OWNER through owner and admin guards', async () => {
    const req = { user: { role: UserRole.OWNER } } as any;
    const ownerReply = makeReply();
    const adminReply = makeReply();
    await requireOwner(req, ownerReply as any);
    await requireAdmin(req, adminReply as any);
    expect(ownerReply.statusCode).toBe(0);
    expect(adminReply.statusCode).toBe(0);
  });
});
