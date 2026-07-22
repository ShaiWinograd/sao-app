'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { api, authHeaders } from '../../lib/api';
import { ViewerRoleContext } from '../../lib/use-viewer-role';
import type { AppViewerRole } from '../../lib/viewer-access';

type Area = 'owner' | 'worker';
type GateState = 'checking' | 'authorized' | 'blocked';

function toViewerRole(role: string): AppViewerRole {
  return role === 'OWNER' || role === 'ADMIN' || role === 'WORKER' ? role : 'WORKER';
}

/**
 * Client-side authorization gate. Consults the authoritative DB role (`/auth/me`)
 * before rendering any app navigation or business data:
 *   - unauthorized (403) → redirect to the standalone unauthorized screen;
 *   - a WORKER inside the owner area → redirect to the worker area;
 *   - otherwise render the children.
 * Until the decision is made, only a spinner is shown — an unknown user never
 * sees the shell or loads owner/worker data. The API is the real boundary (every
 * endpoint returns 403 for an unauthorized user); this mirrors that in the UI.
 */
export default function AuthorizationGate({ area, children }: { area: Area; children: React.ReactNode }) {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();
  const [state, setState] = useState<GateState>('checking');
  const [role, setRole] = useState<AppViewerRole | null>(null);

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      // Authentication is enforced by Clerk middleware; nothing to authorize.
      setState('authorized');
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const auth = await authHeaders(getToken);
        const res = await api.get<{ role: string }>('/auth/me', auth);
        if (cancelled) return;
        if (area === 'owner' && res.data.role === 'WORKER') {
          router.replace('/worker');
          return; // keep blocking during redirect
        }
        setRole(toViewerRole(res.data.role));
        setState('authorized');
      } catch (err) {
        if (cancelled) return;
        const status = (err as { response?: { status?: number } })?.response?.status;
        if (status === 403) {
          setState('blocked');
          router.replace('/unauthorized');
          return;
        }
        // A transient/non-authorization error must not lock out a legitimate user.
        setState('authorized');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, getToken, area, router]);

  if (state !== 'authorized') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-white" dir="rtl">
        <div className="h-6 w-6 animate-spin rounded-full border-2 border-gray-300 border-t-gray-700" />
      </div>
    );
  }
  return <ViewerRoleContext.Provider value={role}>{children}</ViewerRoleContext.Provider>;
}
