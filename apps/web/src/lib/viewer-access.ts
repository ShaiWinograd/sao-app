export type AppViewerRole = 'OWNER' | 'ADMIN' | 'WORKER';

function normalizeRoleValue(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase();
}

// An account with no explicit Clerk role is treated as OWNER, matching the API
// auth default (`publicMetadata.role ?? OWNER`). Real staff are provisioned with
// an explicit ADMIN/WORKER role, which is always respected.
export function resolveAppViewerRole(user: { publicMetadata?: unknown } | null | undefined): AppViewerRole {
  if (!user || typeof user !== 'object') return 'OWNER';
  const metadata = user.publicMetadata;
  if (!metadata || typeof metadata !== 'object') return 'OWNER';
  const roleValue = normalizeRoleValue((metadata as Record<string, unknown>).role);
  if (roleValue === 'OWNER') return 'OWNER';
  if (roleValue === 'ADMIN') return 'ADMIN';
  if (roleValue === 'WORKER') return 'WORKER';
  return 'OWNER';
}

// Whether the account has an explicit role set in Clerk metadata (vs. the default).
// Used to decide who may use the dev/preview role switcher: only an owner or an
// unconfigured account, never a real admin/worker (so they can't self-escalate).
export function hasExplicitViewerRole(user: { publicMetadata?: unknown } | null | undefined): boolean {
  if (!user || typeof user !== 'object') return false;
  const metadata = user.publicMetadata;
  if (!metadata || typeof metadata !== 'object') return false;
  const roleValue = normalizeRoleValue((metadata as Record<string, unknown>).role);
  return roleValue === 'OWNER' || roleValue === 'ADMIN' || roleValue === 'WORKER';
}

export function canViewReports(role: AppViewerRole) {
  return role === 'OWNER';
}

export function canViewSensitiveFinancials(role: AppViewerRole) {
  return role === 'OWNER';
}

export function viewerRoleLabel(role: AppViewerRole): string {
  if (role === 'OWNER') return 'בעל/ת עסק';
  if (role === 'WORKER') return 'עובד/ת';
  return 'מנהל/ת';
}
