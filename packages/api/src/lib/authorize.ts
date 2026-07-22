import { UserRole } from '@workforce/shared';

/**
 * Central, trusted authorization rule for the whole system.
 *
 * Access is granted ONLY from explicit, server-controlled ("trusted") data:
 *   - an explicit Owner/Admin role in Clerk `publicMetadata` (only settable via
 *     the Clerk backend API by an admin — a user cannot set their own); or
 *   - an email that matches a pre-registered Worker record (created by an admin).
 *
 * There is deliberately NO fallback role. An authenticated identity that matches
 * none of the above is NOT authorized (returns `null`) and must be blocked — we
 * never infer OWNER (or any role) from a first login, missing metadata, an email
 * domain, the absence of a Worker match, or being the first user in an
 * environment.
 */
export type AuthorizedRole = UserRole.OWNER | UserRole.ADMIN | UserRole.WORKER;

/**
 * Pure authorization decision. Kept side-effect free (no DB, no I/O) so the rule
 * itself is trivially unit-testable. Callers resolve the two trusted inputs
 * (Clerk metadata role + whether a pre-registered Worker matches) and pass them in.
 */
export function decideAuthorizedRole(input: {
  metaRole: unknown;
  hasWorkerMatch: boolean;
}): AuthorizedRole | null {
  // Privileged roles come exclusively from explicit, admin-set Clerk metadata.
  if (input.metaRole === UserRole.OWNER) return UserRole.OWNER;
  if (input.metaRole === UserRole.ADMIN) return UserRole.ADMIN;
  // Worker access comes exclusively from a pre-registered Worker record.
  if (input.hasWorkerMatch) return UserRole.WORKER;
  // Everyone else is unauthorized. No default, ever.
  return null;
}

// ─── Rate-limited authorization-denied logging ────────────────────────────────
// `authenticate` runs on every request, so an unauthorized identity would hit the
// denial path repeatedly. We log the denial at most once per user per window to
// keep the audit signal (login/bootstrap denial) without flooding the logs.
const DENIED_LOG_WINDOW_MS = 5 * 60 * 1000;
const lastDeniedLogAt = new Map<string, number>();

/**
 * Returns true at most once per `userId` per window, so the caller logs a single
 * authorization-denied event per bootstrap attempt rather than one per request.
 */
export function shouldLogAuthorizationDenied(userId: string, now: number = Date.now()): boolean {
  const last = lastDeniedLogAt.get(userId) ?? 0;
  if (now - last < DENIED_LOG_WINDOW_MS) return false;
  lastDeniedLogAt.set(userId, now);
  return true;
}

/** Test-only: reset the in-memory denial-log throttle. */
export function __resetAuthorizationDeniedLog(): void {
  lastDeniedLogAt.clear();
}
