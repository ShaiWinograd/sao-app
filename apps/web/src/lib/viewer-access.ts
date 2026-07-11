export type AppViewerRole = 'OWNER' | 'ADMIN' | 'WORKER';

function normalizeRoleValue(value: unknown): string {
  if (typeof value !== 'string') return '';
  return value.trim().toUpperCase();
}

export function resolveAppViewerRole(user: { publicMetadata?: unknown } | null | undefined): AppViewerRole {
  if (!user || typeof user !== 'object') return 'ADMIN';
  const metadata = user.publicMetadata;
  if (!metadata || typeof metadata !== 'object') return 'ADMIN';
  const roleValue = normalizeRoleValue((metadata as Record<string, unknown>).role);
  if (roleValue === 'OWNER') return 'OWNER';
  if (roleValue === 'ADMIN') return 'ADMIN';
  if (roleValue === 'WORKER') return 'WORKER';
  return 'ADMIN';
}

export function canViewReports(role: AppViewerRole) {
  return role === 'OWNER';
}

export function canViewSensitiveFinancials(role: AppViewerRole) {
  return role === 'OWNER';
}
