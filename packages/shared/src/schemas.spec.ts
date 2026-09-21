import { describe, expect, it } from 'vitest';
import { JoinRequestSchema, CustomerSchema, CreateJobSchema, CreateWorkerSchema } from './schemas';

describe('JoinRequestSchema (§ join-request 500 fix)', () => {
  it('accepts a body WITHOUT workerId (worker is derived from the session)', () => {
    const parsed = JoinRequestSchema.parse({ jobId: 'job-1' });
    expect(parsed.jobId).toBe('job-1');
    expect(parsed.workerId).toBeUndefined();
  });

  it('still accepts an optional workerId (backward compatible) and slotId', () => {
    const parsed = JoinRequestSchema.parse({ jobId: 'job-1', workerId: 'w-1', slotId: 's-1' });
    expect(parsed).toMatchObject({ jobId: 'job-1', workerId: 'w-1', slotId: 's-1' });
  });

  it('requires jobId', () => {
    expect(() => JoinRequestSchema.parse({})).toThrow();
  });
});

describe('CustomerSchema (email optional)', () => {
  it('accepts a customer with no email', () => {
    const parsed = CustomerSchema.parse({ firstName: 'TEST', phone: '0500000000' });
    expect(parsed.firstName).toBe('TEST');
    expect(parsed.email).toBeUndefined();
    expect(parsed.lastName).toBe(''); // optional, defaults to ''
  });

  describe('CreateJobSchema (trainee labor)', () => {
    const validJob = {
      caseId: 'case-1',
      customerId: 'customer-1',
      addressId: 'address-1',
      jobType: 'PACKING' as const,
      date: '2026-10-01T00:00:00.000Z',
      plannedStart: '2026-10-01T09:00:00.000Z',
      plannedEnd: '2026-10-01T14:00:00.000Z',
      requiredWorkerCount: 2,
      staffingMode: 'MANAGER_APPROVAL' as const,
    };

    it('accepts an external trainee without a platform worker account', () => {
      expect(
        CreateJobSchema.parse({
          ...validJob,
          traineeName: 'נועה כהן',
          traineeHourlyWage: 50,
          traineeApprovedHours: 4.5,
        }),
      ).toMatchObject({ traineeName: 'נועה כהן', traineeHourlyWage: 50, traineeApprovedHours: 4.5 });
    });

    it('rejects negative trainee pay or hours', () => {
      expect(() => CreateJobSchema.parse({ ...validJob, traineeHourlyWage: -1 })).toThrow();
      expect(() => CreateJobSchema.parse({ ...validJob, traineeApprovedHours: -0.25 })).toThrow();
    });
  });

  describe('CreateWorkerSchema (Hebrew system name)', () => {
    const validWorker = {
      firstName: 'שי',
      lastName: 'וינוגרד',
      phone: '0500000000',
      email: 'worker@example.com',
      hourlyWage: 70,
      dailyPaymentAmount: 560,
      paymentMethod: 'BANK_TRANSFER' as const,
      skills: ['GENERAL_WORKER'] as const,
    };

    it('accepts a full Hebrew worker name', () => {
      expect(CreateWorkerSchema.parse(validWorker)).toMatchObject({
        firstName: 'שי',
        lastName: 'וינוגרד',
      });
    });

    it('rejects an English name or a missing family name', () => {
      expect(() => CreateWorkerSchema.parse({ ...validWorker, firstName: 'Shai' })).toThrow();
      expect(() => CreateWorkerSchema.parse({ ...validWorker, lastName: '' })).toThrow();
    });
  });

  it('treats an empty-string email as "not provided"', () => {
    const parsed = CustomerSchema.parse({ firstName: 'TEST', phone: '0500000000', email: '  ' });
    expect(parsed.email).toBeUndefined();
  });

  it('accepts a valid email', () => {
    const parsed = CustomerSchema.parse({ firstName: 'TEST', phone: '0500000000', email: 'a@b.com' });
    expect(parsed.email).toBe('a@b.com');
  });

  it('rejects a non-empty invalid email', () => {
    expect(() => CustomerSchema.parse({ firstName: 'TEST', phone: '0500000000', email: 'not-an-email' })).toThrow();
  });

  it('still requires first name and phone', () => {
    expect(() => CustomerSchema.parse({ phone: '0500000000' })).toThrow();
    expect(() => CustomerSchema.parse({ firstName: 'TEST' })).toThrow();
  });
});
