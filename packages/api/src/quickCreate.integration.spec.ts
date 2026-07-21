/**
 * Quick Create hotfix integration tests: duplicate-prevention (idempotency key)
 * and customer→job linkage (the relationship the customer page queries must match
 * what Quick Create writes). Real Postgres via TEST_DATABASE_URL; skipped in CI.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';

const TEST_DB = process.env.TEST_DATABASE_URL;
const prisma = new PrismaClient(TEST_DB ? { datasources: { db: { url: TEST_DB } } } : undefined);

let seq = 0;
const uid = (p: string) => `${p}-${Date.now()}-${seq++}`;
const DATE = new Date('2999-03-01T00:00:00.000Z');

async function clean() {
  await prisma.customerReportVersion.deleteMany({});
  await prisma.auditLog.deleteMany({});
  await prisma.shift.deleteMany({});
  await prisma.jobSlot.deleteMany({});
  await prisma.job.deleteMany({});
  await prisma.address.deleteMany({});
  await prisma.customerCase.deleteMany({});
  await prisma.customer.deleteMany({});
}

async function seedCustomerCaseAddress(email?: string | null) {
  const customer = await prisma.customer.create({
    data: { firstName: 'TEST', lastName: uid('c'), phone: '0500000000', email: email ?? null },
  });
  const kase = await prisma.customerCase.create({ data: { customerId: customer.id, name: 'Case', status: 'ACTIVE' } });
  const address = await prisma.address.create({ data: { customerId: customer.id, fullAddress: 'X', label: 'OTHER' } });
  return { customer, kase, address };
}

function jobData(customerId: string, caseId: string, addressId: string, idempotencyKey?: string) {
  return {
    caseId, customerId, addressId, jobType: 'PACKING' as const,
    date: DATE, plannedStart: DATE, plannedEnd: DATE, requiredWorkerCount: 1,
    ...(idempotencyKey ? { idempotencyKey } : {}),
  };
}

const maybe = TEST_DB ? describe : describe.skip;

maybe('Quick Create hotfix — linkage + idempotency', () => {
  beforeEach(clean);
  afterAll(async () => { await prisma.$disconnect(); });

  it('persists a customer with no email and links a job to that exact customer id', async () => {
    const { customer, kase, address } = await seedCustomerCaseAddress(null);
    expect(customer.email).toBeNull();
    const job = await prisma.job.create({ data: jobData(customer.id, kase.id, address.id) });
    // The relationship the customer page queries (jobs by customerId) must match.
    const jobsForCustomer = await prisma.job.findMany({ where: { customerId: customer.id } });
    expect(jobsForCustomer.map((j) => j.id)).toContain(job.id);
    expect(job.customerId).toBe(customer.id);
  });

  it('enforces the idempotency key — a duplicate submission cannot create a second job', async () => {
    const { customer, kase, address } = await seedCustomerCaseAddress('a@b.com');
    await prisma.job.create({ data: jobData(customer.id, kase.id, address.id, 'idem-key-123') });
    await expect(
      prisma.job.create({ data: jobData(customer.id, kase.id, address.id, 'idem-key-123') }),
    ).rejects.toMatchObject({ code: 'P2002' });
    // Exactly one job exists for that key.
    const jobs = await prisma.job.findMany({ where: { idempotencyKey: 'idem-key-123' } });
    expect(jobs).toHaveLength(1);
  });

  it('allows distinct idempotency keys (two real jobs)', async () => {
    const { customer, kase, address } = await seedCustomerCaseAddress('a@b.com');
    await prisma.job.create({ data: jobData(customer.id, kase.id, address.id, 'k-a') });
    await prisma.job.create({ data: jobData(customer.id, kase.id, address.id, 'k-b') });
    expect(await prisma.job.count({ where: { customerId: customer.id } })).toBe(2);
  });

  it('allows many jobs with no idempotency key (null is not unique)', async () => {
    const { customer, kase, address } = await seedCustomerCaseAddress('a@b.com');
    await prisma.job.create({ data: jobData(customer.id, kase.id, address.id) });
    await prisma.job.create({ data: jobData(customer.id, kase.id, address.id) });
    expect(await prisma.job.count({ where: { customerId: customer.id } })).toBe(2);
  });
});
