import { afterEach, describe, expect, it } from 'vitest';
import { UserRole } from '@workforce/shared';
import {
  decideAuthorizedRole,
  shouldLogAuthorizationDenied,
  __resetAuthorizationDeniedLog,
} from './authorize.js';

describe('decideAuthorizedRole (trusted authorization rule)', () => {
  it('grants OWNER only from an explicit owner metadata role', () => {
    expect(decideAuthorizedRole({ metaRole: UserRole.OWNER, hasWorkerMatch: false })).toBe(UserRole.OWNER);
  });

  it('grants an invited admin only the ADMIN role', () => {
    expect(decideAuthorizedRole({ metaRole: UserRole.ADMIN, hasWorkerMatch: false })).toBe(UserRole.ADMIN);
  });

  it('grants WORKER from a pre-registered Worker match', () => {
    expect(decideAuthorizedRole({ metaRole: undefined, hasWorkerMatch: true })).toBe(UserRole.WORKER);
  });

  it('never becomes OWNER when metadata is missing', () => {
    expect(decideAuthorizedRole({ metaRole: undefined, hasWorkerMatch: false })).toBeNull();
    expect(decideAuthorizedRole({ metaRole: null, hasWorkerMatch: false })).toBeNull();
    expect(decideAuthorizedRole({ metaRole: '', hasWorkerMatch: false })).toBeNull();
  });

  it('returns null for an unknown authenticated identity (no metadata, no worker match)', () => {
    expect(decideAuthorizedRole({ metaRole: 'GUEST', hasWorkerMatch: false })).toBeNull();
  });

  it('does not grant WORKER from bare worker metadata without a Worker match', () => {
    // Worker access must be backed by an admin-created Worker record.
    expect(decideAuthorizedRole({ metaRole: UserRole.WORKER, hasWorkerMatch: false })).toBeNull();
  });

  it('never infers a role from a truthy-but-unrecognized metadata value', () => {
    expect(decideAuthorizedRole({ metaRole: 'owner', hasWorkerMatch: false })).toBeNull(); // case-sensitive on purpose
    expect(decideAuthorizedRole({ metaRole: true, hasWorkerMatch: false })).toBeNull();
    expect(decideAuthorizedRole({ metaRole: 1, hasWorkerMatch: false })).toBeNull();
  });
});

describe('shouldLogAuthorizationDenied (rate-limited denial logging)', () => {
  afterEach(() => __resetAuthorizationDeniedLog());

  it('logs once per user then suppresses repeats within the window', () => {
    const t0 = 1_000_000;
    expect(shouldLogAuthorizationDenied('user-1', t0)).toBe(true);
    expect(shouldLogAuthorizationDenied('user-1', t0 + 1)).toBe(false);
    expect(shouldLogAuthorizationDenied('user-1', t0 + 60_000)).toBe(false);
  });

  it('logs again after the window elapses', () => {
    const t0 = 2_000_000;
    expect(shouldLogAuthorizationDenied('user-2', t0)).toBe(true);
    expect(shouldLogAuthorizationDenied('user-2', t0 + 5 * 60 * 1000)).toBe(true);
  });

  it('tracks users independently', () => {
    const t0 = 3_000_000;
    expect(shouldLogAuthorizationDenied('user-a', t0)).toBe(true);
    expect(shouldLogAuthorizationDenied('user-b', t0)).toBe(true);
  });
});
