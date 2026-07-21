import { describe, expect, it } from 'vitest';
import { JoinRequestSchema, CustomerSchema } from './schemas';

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
