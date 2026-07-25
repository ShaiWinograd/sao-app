/**
 * PR-A Quick Create — integration against the REAL orchestration (createQuickJob).
 * Proves, against real Postgres, that the route's domain function persists exactly
 * what the address contract promises, NEVER writes on a failed selection, and — the
 * key orphan-safety guarantee — performs EVERY write (customer/case/address/job)
 * only inside the transaction after the idempotency lock. Route and tests execute
 * the same implementation (no "mirror" helper). Gated by TEST_DATABASE_URL.
 */
import { PrismaClient } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { GENERAL_RESERVATION_CUSTOMER_ID } from '@workforce/shared';
import { createQuickJob, type QuickJobInput } from './domain/quickCreateJob.js';
import { signSelectionToken, type SignSelectionInput } from './lib/geocoding/selectionToken.js';
import type { GeocodeAddressComponents } from './lib/geocoding/types.js';

const TEST_DB = process.env.TEST_DATABASE_URL;
const prisma = new PrismaClient(TEST_DB ? { datasources: { db: { url: TEST_DB } } } : undefined);

const SECRET = 'test-selection-secret-0123456789';
const NOW = new Date('2026-07-25T12:00:00Z');
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
  // Comprehensive wipe (mirrors the other integration specs) so residue from a
  // prior spec in the sequential run cannot block a delete via a foreign key.
  await prisma.customerReportVersion.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.notification.deleteMany({});
  await prisma.formSubmission.deleteMany({});
  await prisma.locationCheck.deleteMany({});
  await prisma.attendanceCorrection.deleteMany({});
  await prisma.shiftSwap.deleteMany({});
  await prisma.replacementRequest.deleteMany({});
  await prisma.shift.deleteMany({});
  await prisma.jobSlot.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.address.deleteMany({});
  await prisma.customerCase.deleteMany({});
  await prisma.worker.deleteMany({});
  await prisma.user.deleteMany({});
  await prisma.customer.deleteMany({});
}

async function seedOwner() {
  return prisma.user.create({ data: { id: uid('owner'), email: `${uid('o')}@t.test`, firstName: 'O', lastName: 'wner', role: 'OWNER' } });
}
async function seedCustomer() {
  return prisma.customer.create({ data: { firstName: 'Existing', lastName: uid('c'), phone: '03' } });
}
async function seedGeneralReservation() {
  return prisma.customer.create({ data: { id: GENERAL_RESERVATION_CUSTOMER_ID, firstName: 'שריון', lastName: 'כללי', phone: '-', isSystem: true } });
}

function baseBody(over: Partial<QuickJobInput> = {}): QuickJobInput {
  return {
    newCustomer: { firstName: 'New', lastName: 'Customer', phone: '0500000000' },
    jobType: 'PACKING',
    date: '2999-05-01',
    startTime: '09:00',
    endTime: '14:00',
    requiredWorkerCount: 1,
    requiresTeamLeader: false,
    ...over,
  };
}

function run(client: PrismaClient, body: QuickJobInput, deps: { secret?: string | null; now?: Date; actor?: { id?: string } | null } = {}) {
  return createQuickJob(client, body, { provider: null, secret: deps.secret ?? SECRET, now: deps.now ?? NOW, actor: deps.actor ?? null });
}

// A client whose in-transaction `job.create` always throws — proves that a failure
// AFTER inline customer creation rolls the customer, case, address, job and slots
// back together.
function clientWithFailingJobCreate(base: PrismaClient): PrismaClient {
  return new Proxy(base, {
    get(target, prop) {
      if (prop === '$transaction') {
        return (cb: any, opts: any) =>
          (base as any).$transaction((tx: any) => {
            const txProxy = new Proxy(tx, {
              get(t, p) {
                if (p === 'job') {
                  return new Proxy(t.job, {
                    get(jt, jp) {
                      if (jp === 'create') return async () => { throw new Error('job-boom'); };
                      const v = (jt as any)[jp];
                      return typeof v === 'function' ? v.bind(jt) : v;
                    },
                  });
                }
                const v = (t as any)[p];
                return typeof v === 'function' ? v.bind(t) : v;
              },
            });
            return cb(txProxy);
          }, opts);
      }
      const v = (target as any)[prop];
      return typeof v === 'function' ? v.bind(target) : v;
    },
  }) as PrismaClient;
}

const counts = async () => ({
  customers: await prisma.customer.count(),
  cases: await prisma.customerCase.count(),
  addresses: await prisma.address.count(),
  jobs: await prisma.job.count(),
});

const maybe = TEST_DB ? describe : describe.skip;

maybe('PR-A Quick Create address contract (real createQuickJob)', () => {
  beforeEach(clean);
  afterAll(async () => { await clean(); await prisma.$disconnect(); });

  it('legacy cityOrAddress creates job + address (NOT_REQUESTED without a provider)', async () => {
    const owner = await seedOwner();
    const { job } = await run(prisma, baseBody({ cityOrAddress: 'תל אביב' }), { secret: null, actor: { id: owner.id } });
    const address = await prisma.address.findUnique({ where: { id: job.addressId! } });
    expect(address?.fullAddress).toBe('תל אביב');
    expect(address?.geocodeStatus).toBe('NOT_REQUESTED');
    expect(address?.latitude).toBeNull();
    expect((await counts()).customers).toBe(1);
  });

  it('a valid exact-address token creates a RESOLVED address with coordinates atomically with the job', async () => {
    const owner = await seedOwner();
    const { job } = await run(prisma, baseBody({ address: { mode: 'selected', token: token() } }), { actor: { id: owner.id } });
    const address = await prisma.address.findUnique({ where: { id: job.addressId! } });
    expect(address?.geocodeStatus).toBe('RESOLVED');
    expect(address?.latitude).toBeCloseTo(32.084, 3);
    expect(address?.normalizedAddress).toBe('ישעיהו 22, רמת גן');
    expect(address?.geocodeProviderPlaceId).toBe('p-1');
  });

  it('a tampered token creates nothing (no customer/case/address/job)', async () => {
    await seedOwner();
    const t = token();
    const [body, sig] = t.split('.');
    const forged = Buffer.from(JSON.stringify({ ...JSON.parse(Buffer.from(body, 'base64url').toString()), lat: 0 })).toString('base64url');
    await expect(run(prisma, baseBody({ address: { mode: 'selected', token: `${forged}.${sig}` } }))).rejects.toMatchObject({ code: 'ADDRESS_SELECTION_INVALID' });
    expect(await counts()).toMatchObject({ customers: 0, cases: 0, addresses: 0, jobs: 0 });
  });

  it('a low-precision selection does not create a NEEDS_REVIEW job silently (no writes)', async () => {
    await seedOwner();
    await expect(run(prisma, baseBody({ address: { mode: 'selected', token: token({ precision: 'STREET' }) } }))).rejects.toMatchObject({ code: 'ADDRESS_NOT_RESOLVABLE' });
    expect(await counts()).toMatchObject({ customers: 0, cases: 0, addresses: 0, jobs: 0 });
  });

  it('the manual fallback creates a NEEDS_REVIEW address with null coordinates', async () => {
    const owner = await seedOwner();
    const { job } = await run(prisma, baseBody({ address: { mode: 'manual', text: 'ישעיהו 22 רמת גן', confirmedUnresolved: true } }), { actor: { id: owner.id } });
    const address = await prisma.address.findUnique({ where: { id: job.addressId! } });
    expect(address?.geocodeStatus).toBe('NEEDS_REVIEW');
    expect(address?.latitude).toBeNull();
  });

  it('existing-customer path links the job to that customer without creating a new one', async () => {
    const owner = await seedOwner();
    const existing = await seedCustomer();
    const { job } = await run(prisma, baseBody({ newCustomer: undefined, customerId: existing.id, address: { mode: 'selected', token: token() } }), { actor: { id: owner.id } });
    expect(job.customerId).toBe(existing.id);
    expect(await prisma.customer.count()).toBe(1); // no new customer
  });

  it('general-reservation path links the job to the GR customer', async () => {
    const owner = await seedOwner();
    const gr = await seedGeneralReservation();
    const { job } = await run(prisma, baseBody({ newCustomer: undefined, generalReservation: true, address: { mode: 'selected', token: token() } }), { actor: { id: owner.id } });
    expect(job.customerId).toBe(gr.id);
    expect(await prisma.customer.count()).toBe(1);
  });
});

maybe('PR-A Quick Create orchestration — idempotency + orphan safety (real createQuickJob)', () => {
  beforeEach(clean);
  afterAll(async () => { await clean(); await prisma.$disconnect(); });

  it('two concurrent inline-newCustomer submissions with the same key create exactly one customer/case/address/job + expected slots', async () => {
    const owner = await seedOwner();
    const key = 'idem-concurrent-newcust';
    const body = baseBody({ requiredWorkerCount: 2, requiresTeamLeader: true, idempotencyKey: key, address: { mode: 'selected', token: token() } });
    const [a, b] = await Promise.all([
      run(prisma, body, { actor: { id: owner.id } }),
      run(prisma, body, { actor: { id: owner.id } }),
    ]);
    expect(a.job.id).toBe(b.job.id); // both observers see the same single job
    expect(await counts()).toMatchObject({ customers: 1, cases: 1, addresses: 1, jobs: 1 });
    const slots = await prisma.jobSlot.findMany({ where: { jobId: a.job.id } });
    expect(slots).toHaveLength(2);
    expect(slots.filter((s) => s.requiredSkill === 'SHIFT_LEADER')).toHaveLength(1);
  });

  it('a replay with an expired token and inline newCustomer returns the original job without creating another customer', async () => {
    const owner = await seedOwner();
    const key = 'idem-replay-newcust';
    const first = await run(prisma, baseBody({ idempotencyKey: key, address: { mode: 'selected', token: token() } }), { actor: { id: owner.id } });
    const expired = token({}, { now: NOW, ttlSeconds: 60 });
    const later = new Date(NOW.getTime() + 61_000);
    const replay = await run(prisma, baseBody({ idempotencyKey: key, address: { mode: 'selected', token: expired } }), { now: later, actor: { id: owner.id } });
    expect(replay.idempotentReplay).toBe(true);
    expect(replay.job.id).toBe(first.job.id);
    expect(await counts()).toMatchObject({ customers: 1, jobs: 1 });
  });

  it('a failed selected-address submission with inline newCustomer creates nothing and does not poison the key', async () => {
    const owner = await seedOwner();
    const key = 'idem-failed-newcust';
    const expired = token({}, { now: NOW, ttlSeconds: 60 });
    const later = new Date(NOW.getTime() + 61_000);
    await expect(run(prisma, baseBody({ idempotencyKey: key, address: { mode: 'selected', token: expired } }), { now: later, actor: { id: owner.id } }))
      .rejects.toMatchObject({ code: 'ADDRESS_SELECTION_EXPIRED' });
    expect(await counts()).toMatchObject({ customers: 0, cases: 0, addresses: 0, jobs: 0 });
    // The key is not poisoned — a valid submission with the SAME key then succeeds.
    const ok = await run(prisma, baseBody({ idempotencyKey: key, address: { mode: 'selected', token: token() } }), { actor: { id: owner.id } });
    expect(ok.idempotentReplay).toBe(false);
    expect(await counts()).toMatchObject({ customers: 1, jobs: 1 });
  });

  it('a transaction failure after inline customer creation rolls back the customer, case, address, job, and slots together', async () => {
    const owner = await seedOwner();
    await expect(
      run(clientWithFailingJobCreate(prisma), baseBody({ address: { mode: 'selected', token: token() } }), { actor: { id: owner.id } }),
    ).rejects.toThrow('job-boom');
    expect(await counts()).toMatchObject({ customers: 0, cases: 0, addresses: 0, jobs: 0 });
    expect(await prisma.jobSlot.count()).toBe(0);
  });
});
