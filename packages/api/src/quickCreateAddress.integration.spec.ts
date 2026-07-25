/**
 * PR-A Quick Create address contract — integration. Proves against real Postgres
 * (the GeocodeStatus enum + Float lat/lon columns) that the address resolution
 * feeding POST /jobs/quick persists exactly what the contract promises and NEVER
 * writes on a failed selection. Mirrors the route's create (resolve → tx: address
 * + job). Gated by TEST_DATABASE_URL; skipped in CI.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { resolveQuickCreateAddress } from './domain/quickCreateAddress.js';
import { lockIdempotencyKey } from './lib/commitment.js';
import { signSelectionToken, type SignSelectionInput } from './lib/geocoding/selectionToken.js';
import type { GeocodeAddressComponents } from './lib/geocoding/types.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
const prisma = new PrismaClient(TEST_DB ? { datasources: { db: { url: TEST_DB } } } : undefined);

const SECRET = 'test-selection-secret-0123456789';
const NOW = new Date('2026-07-25T12:00:00Z');
const DATE = new Date('2999-05-01T00:00:00.000Z');
const components: GeocodeAddressComponents = { streetName: 'ישעיהו', streetNumber: '22', municipality: 'רמת גן', postalCode: '5223392', countryCode: 'IL' };

let seq = 0;
const uid = (p: string) => `${p}-${Date.now()}-${seq++}`;

function token(over: Partial<SignSelectionInput> = {}, opts: { now?: Date; ttlSeconds?: number } = {}): string {
  const input: SignSelectionInput = {
    provider: 'azure-maps', providerPlaceId: 'p-1', lat: 32.084, lon: 34.81, precision: 'HOUSE', confidence: 0.95,
    city: 'רמת גן', components, display: 'ישעיהו 22, רמת גן', ambiguous: false, query: 'ישעיהו 22 רמת גן', ...over,
  };
  return signSelectionToken(input, SECRET, { now: opts.now ?? NOW, ttlSeconds: opts.ttlSeconds });
}

async function clean() {
  await prisma.auditLog.deleteMany({});
  await prisma.shift.deleteMany({});
  await prisma.jobSlot.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.address.deleteMany({});
  await prisma.customerCase.deleteMany({});
  await prisma.customer.deleteMany({});
}

async function seed() {
  const customer = await prisma.customer.create({ data: { firstName: 'C', lastName: uid('c'), phone: '03' } });
  const kase = await prisma.customerCase.create({ data: { customerId: customer.id, name: 'Case', status: 'ACTIVE' } });
  return { customer, kase };
}

// Mirrors the route: resolve first (may throw → no write), then create address+job atomically.
async function createQuickJob(customerId: string, caseId: string, args: Parameters<typeof resolveQuickCreateAddress>[0], secret: string | null) {
  const resolved = await resolveQuickCreateAddress(args, { provider: null, secret, now: NOW });
  return prisma.$transaction(async (tx) => {
    const address = await tx.address.create({ data: { customerId, fullAddress: resolved.fullAddress, label: 'OTHER', ...(resolved.apply ?? {}) } });
    const job = await tx.job.create({
      data: { caseId, customerId, addressId: address.id, jobType: 'PACKING', date: DATE, plannedStart: DATE, plannedEnd: DATE, requiredWorkerCount: 1, status: 'RESERVATION' },
    });
    return { address, job };
  });
}

// Mirrors the FULL /jobs/quick idempotency ordering: (1) a pre-resolution fast-path
// replay lookup, (2) address resolution (may throw), (3) an in-transaction advisory
// lock + recheck before create. Used to prove a replay never depends on a still-valid
// token/config.
async function quickCreateIdem(
  customerId: string,
  caseId: string,
  args: Parameters<typeof resolveQuickCreateAddress>[0],
  opts: { secret: string | null; now?: Date; idempotencyKey?: string },
): Promise<{ jobId: string; replay: boolean }> {
  const key = opts.idempotencyKey;
  // (1) Fast-path replay — BEFORE any address resolution or token/config check.
  if (key) {
    const existing = await prisma.job.findFirst({ where: { idempotencyKey: key } });
    if (existing) return { jobId: existing.id, replay: true };
  }
  // (2) Resolve (throws on a bad selection → nothing written).
  const resolved = await resolveQuickCreateAddress(args, { provider: null, secret: opts.secret, now: opts.now ?? NOW });
  // (3) Atomic create with an in-tx lock + recheck.
  const job = await prisma.$transaction(async (tx) => {
    if (key) {
      await lockIdempotencyKey(tx, key);
      const existing = await tx.job.findFirst({ where: { idempotencyKey: key } });
      if (existing) return existing;
    }
    const address = await tx.address.create({ data: { customerId, fullAddress: resolved.fullAddress, label: 'OTHER', ...(resolved.apply ?? {}) } });
    return tx.job.create({
      data: { caseId, customerId, addressId: address.id, jobType: 'PACKING', date: DATE, plannedStart: DATE, plannedEnd: DATE, requiredWorkerCount: 1, status: 'RESERVATION', idempotencyKey: key ?? null },
    });
  });
  return { jobId: job.id, replay: false };
}

const maybe = TEST_DB ? describe : describe.skip;

maybe('PR-A Quick Create address contract', () => {
  beforeEach(clean);
  afterAll(async () => { await clean(); await prisma.$disconnect(); });

  it('legacy cityOrAddress still creates a job + address (NOT_REQUESTED without a provider)', async () => {
    const { customer, kase } = await seed();
    const { address, job } = await createQuickJob(customer.id, kase.id, { cityOrAddress: 'תל אביב' }, null);
    expect(job.customerId).toBe(customer.id);
    expect(address.fullAddress).toBe('תל אביב');
    expect(address.geocodeStatus).toBe('NOT_REQUESTED');
    expect(address.latitude).toBeNull();
  });

  it('a valid exact-address token creates a RESOLVED address with coordinates atomically with the job', async () => {
    const { customer, kase } = await seed();
    const { address, job } = await createQuickJob(customer.id, kase.id, { address: { mode: 'selected', token: token() } }, SECRET);
    expect(address.geocodeStatus).toBe('RESOLVED');
    expect(address.latitude).toBeCloseTo(32.084, 3);
    expect(address.longitude).toBeCloseTo(34.81, 2);
    expect(address.normalizedAddress).toBe('ישעיהו 22, רמת גן');
    expect(address.geocodeProviderPlaceId).toBe('p-1');
    // Atomic: the job points at exactly this address.
    expect(job.addressId).toBe(address.id);
  });

  it('a tampered token creates NO job and NO address', async () => {
    const { customer, kase } = await seed();
    const t = token();
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), lat: 0 })).toString('base64url');
    await expect(createQuickJob(customer.id, kase.id, { address: { mode: 'selected', token: `${forged}.${sig}` } }, SECRET)).rejects.toMatchObject({ code: 'ADDRESS_SELECTION_INVALID' });
    expect(await prisma.job.count()).toBe(0);
    expect(await prisma.address.count()).toBe(0);
  });

  it('an expired token creates no write', async () => {
    const { customer, kase } = await seed();
    const t = token({}, { now: NOW, ttlSeconds: 60 });
    const later = new Date(NOW.getTime() + 61_000);
    await expect(
      resolveQuickCreateAddress({ address: { mode: 'selected', token: t } }, { provider: null, secret: SECRET, now: later }),
    ).rejects.toMatchObject({ code: 'ADDRESS_SELECTION_EXPIRED' });
    expect(await prisma.job.count()).toBe(0);
    expect(await prisma.address.count()).toBe(0);
  });

  it('a low-precision selection does not create a NEEDS_REVIEW job silently', async () => {
    const { customer, kase } = await seed();
    await expect(createQuickJob(customer.id, kase.id, { address: { mode: 'selected', token: token({ precision: 'STREET' }) } }, SECRET)).rejects.toMatchObject({ code: 'ADDRESS_NOT_RESOLVABLE' });
    expect(await prisma.job.count()).toBe(0);
    expect(await prisma.address.count()).toBe(0);
  });

  it('the manual fallback creates a NEEDS_REVIEW address with null coordinates', async () => {
    const { customer, kase } = await seed();
    const { address } = await createQuickJob(customer.id, kase.id, { address: { mode: 'manual', text: 'ישעיהו 22 רמת גן', confirmedUnresolved: true } }, SECRET);
    expect(address.geocodeStatus).toBe('NEEDS_REVIEW');
    expect(address.latitude).toBeNull();
    expect(address.longitude).toBeNull();
    expect(address.fullAddress).toBe('ישעיהו 22 רמת גן');
  });
});

maybe('PR-A Quick Create idempotent replay (does not depend on a valid token/config)', () => {
  beforeEach(clean);
  afterAll(async () => { await clean(); await prisma.$disconnect(); });

  it('a retry with the same key returns the original job even after the selection token expired', async () => {
    const { customer, kase } = await seed();
    const key = 'idem-expired-1';
    const first = await quickCreateIdem(customer.id, kase.id, { address: { mode: 'selected', token: token() } }, { secret: SECRET, idempotencyKey: key });
    expect(first.replay).toBe(false);
    // Retry with the SAME key but a now-expired token and a future clock — the
    // fast-path replay must return the original job without touching resolution.
    const expiredToken = token({}, { now: NOW, ttlSeconds: 60 });
    const later = new Date(NOW.getTime() + 61_000);
    const retry = await quickCreateIdem(customer.id, kase.id, { address: { mode: 'selected', token: expiredToken } }, { secret: SECRET, now: later, idempotencyKey: key });
    expect(retry).toEqual({ jobId: first.jobId, replay: true });
    expect(await prisma.job.count({ where: { idempotencyKey: key } })).toBe(1);
  });

  it('a retry returns the original job even after signing config becomes unavailable', async () => {
    const { customer, kase } = await seed();
    const key = 'idem-noconfig-1';
    const first = await quickCreateIdem(customer.id, kase.id, { address: { mode: 'selected', token: token() } }, { secret: SECRET, idempotencyKey: key });
    // secret=null simulates the signing secret being removed; the replay still works.
    const retry = await quickCreateIdem(customer.id, kase.id, { address: { mode: 'selected', token: token() } }, { secret: null, idempotencyKey: key });
    expect(retry).toEqual({ jobId: first.jobId, replay: true });
    expect(await prisma.job.count({ where: { idempotencyKey: key } })).toBe(1);
  });

  it('two concurrent first submissions with the same key create exactly one job + address', async () => {
    const { customer, kase } = await seed();
    const key = 'idem-concurrent-1';
    const [a, b] = await Promise.all([
      quickCreateIdem(customer.id, kase.id, { address: { mode: 'selected', token: token() } }, { secret: SECRET, idempotencyKey: key }),
      quickCreateIdem(customer.id, kase.id, { address: { mode: 'selected', token: token() } }, { secret: SECRET, idempotencyKey: key }),
    ]);
    expect(a.jobId).toBe(b.jobId); // both observers see the same single job
    expect(await prisma.job.count({ where: { idempotencyKey: key } })).toBe(1);
    const jobs = await prisma.job.findMany({ where: { idempotencyKey: key }, select: { addressId: true } });
    expect(jobs).toHaveLength(1);
    expect(await prisma.address.count()).toBe(1); // no orphaned second address
  });

  it('a failed first submission creates nothing and does not poison the idempotency key', async () => {
    const { customer, kase } = await seed();
    const key = 'idem-failed-1';
    const expiredToken = token({}, { now: NOW, ttlSeconds: 60 });
    const later = new Date(NOW.getTime() + 61_000);
    await expect(
      quickCreateIdem(customer.id, kase.id, { address: { mode: 'selected', token: expiredToken } }, { secret: SECRET, now: later, idempotencyKey: key }),
    ).rejects.toMatchObject({ code: 'ADDRESS_SELECTION_EXPIRED' });
    expect(await prisma.job.count()).toBe(0);
    expect(await prisma.address.count()).toBe(0);
    // The key is not poisoned — a subsequent valid submission with the SAME key succeeds.
    const ok = await quickCreateIdem(customer.id, kase.id, { address: { mode: 'selected', token: token() } }, { secret: SECRET, idempotencyKey: key });
    expect(ok.replay).toBe(false);
    expect(await prisma.job.count({ where: { idempotencyKey: key } })).toBe(1);
  });
});
