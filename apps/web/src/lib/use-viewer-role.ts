'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useUser } from '@clerk/nextjs';
import { type AppViewerRole, resolveAppViewerRole, hasExplicitViewerRole } from './viewer-access';

const OVERRIDE_KEY = 'sao-role-override';

// Authoritative viewer role, supplied by the AuthorizationGate from the DB
// (`/auth/me`). When present it is the source of truth for UI gating, so the
// owner UI never depends on inferring a role from (possibly missing) Clerk
// metadata. Null only outside the gate (e.g. before the check resolves).
export const ViewerRoleContext = createContext<AppViewerRole | null>(null);

export function readRoleOverride(): AppViewerRole | null {
  if (typeof window === 'undefined') return null;
  const value = window.localStorage.getItem(OVERRIDE_KEY);
  return value === 'OWNER' || value === 'ADMIN' || value === 'WORKER' ? value : null;
}

export function writeRoleOverride(role: AppViewerRole | null) {
  if (typeof window === 'undefined') return;
  if (role) window.localStorage.setItem(OVERRIDE_KEY, role);
  else window.localStorage.removeItem(OVERRIDE_KEY);
}

// True when the current account may use the dev/preview role switcher: an owner,
// or an unconfigured account (the developer before a Clerk role is assigned).
// A real admin/worker (explicit Clerk role) can never switch, so they cannot
// self-escalate to see owner-only data.
function accountCanSwitchRole(user: Parameters<typeof resolveAppViewerRole>[0]): boolean {
  return !hasExplicitViewerRole(user) || resolveAppViewerRole(user) === 'OWNER';
}

/**
 * The effective viewer role. On the first (SSR-matching) render it returns the
 * Clerk/base role; after mount it applies the persisted preview override when
 * the account is allowed to switch. This avoids hydration mismatches while still
 * letting the developer flip between owner and admin views.
 */
export function useViewerRole(): AppViewerRole {
  const { user } = useUser();
  const authoritative = useContext(ViewerRoleContext);
  // The DB role (from the gate) is authoritative; fall back to Clerk metadata
  // only when the gate context is absent. Neither path infers OWNER by default.
  const base = authoritative ?? resolveAppViewerRole(user);
  const canSwitch = accountCanSwitchRole(user);
  const [override, setOverride] = useState<AppViewerRole | null>(null);
  useEffect(() => {
    setOverride(canSwitch ? readRoleOverride() : null);
  }, [canSwitch]);
  return override ?? base;
}

export function useCanSwitchRole(): boolean {
  const { user } = useUser();
  const [ready, setReady] = useState(false);
  useEffect(() => setReady(true), []);
  return ready && accountCanSwitchRole(user);
}
