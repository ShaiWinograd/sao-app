/**
 * Quick Create hotfix integration tests: duplicate-prevention (idempotency key)
 * and customer→job linkage (the relationship the customer page queries must match
 * what Quick Create writes). Real Postgres via TEST_DATABASE_URL; skipped in CI.
 */
import { PrismaClient, Prisma } from '@prisma/client';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { lockIdempotencyKey } from './lib/commitment.js';

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

  it('job-first: an inline NEW customer is created and its job appears under that customer immediately', async () => {
    // Mirrors the /jobs/quick resolver: no customerId, no generalReservation → create the customer.
    const created = await prisma.customer.create({
      data: { firstName: 'TEST', lastName: uid('new'), phone: '0501112222', email: null },
    });
    const kase = await prisma.customerCase.create({ data: { customerId: created.id, name: 'Case', status: 'ACTIVE' } });
    const address = await prisma.address.create({ data: { customerId: created.id, fullAddress: 'City', label: 'OTHER' } });
    const job = await prisma.job.create({ data: jobData(created.id, kase.id, address.id) });
    // The customer profile queries jobs directly by the customer relationship.
    const jobsForCustomer = await prisma.job.findMany({ where: { customerId: created.id } });
    expect(jobsForCustomer.map((j) => j.id)).toEqual([job.id]);
  });

  it('job-first: selecting an EXISTING customer links the job to that exact id (no new customer row)', async () => {
    const { customer, kase, address } = await seedCustomerCaseAddress('sel@b.com');
    const before = await prisma.customer.count();
    const job = await prisma.job.create({ data: jobData(customer.id, kase.id, address.id) });
    expect(await prisma.customer.count()).toBe(before); // no extra customer created
    const jobsForCustomer = await prisma.job.findMany({ where: { customerId: customer.id } });
    expect(jobsForCustomer.map((j) => j.id)).toContain(job.id);
  });

  it('idempotency (advisory lock): two CONCURRENT same-key creates make ONE job', async () => {
    const { customer, kase, address } = await seedCustomerCaseAddress('a@b.com');
    // Mirrors the /jobs/quick handler: lock the key, re-check, then create.
    const idempotentCreate = (key: string) =>
      prisma.$transaction(async (tx) => {
        await lockIdempotencyKey(tx, key);
        const existing = await tx.job.findFirst({ where: { idempotencyKey: key } });
        if (existing) return existing;
        return tx.job.create({ data: jobData(customer.id, kase.id, address.id, key) });
      });
    const [a, b] = await Promise.all([idempotentCreate('k-conc'), idempotentCreate('k-conc')]);
    expect(a.id).toBe(b.id);
    expect(await prisma.job.count({ where: { idempotencyKey: 'k-conc' } })).toBe(1);
  });

  it('idempotency: a sequential replay with the same key returns the original job', async () => {
    const { customer, kase, address } = await seedCustomerCaseAddress('a@b.com');
    const idempotentCreate = (key: string) =>
      prisma.$transaction(async (tx) => {
        await lockIdempotencyKey(tx, key);
        const existing = await tx.job.findFirst({ where: { idempotencyKey: key } });
        if (existing) return existing;
        return tx.job.create({ data: jobData(customer.id, kase.id, address.id, key) });
      });
    const first = await idempotentCreate('k-seq');
    const second = await idempotentCreate('k-seq');
    expect(second.id).toBe(first.id);
    expect(await prisma.job.count({ where: { idempotencyKey: 'k-seq' } })).toBe(1);
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
