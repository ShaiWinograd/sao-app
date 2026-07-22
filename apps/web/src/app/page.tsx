'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { api, authHeaders } from '../lib/api';
import { readRoleOverride } from '../lib/use-viewer-role';

export default function HomePage() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();

  useEffect(() => {
    if (!isLoaded) return;
    if (!isSignedIn) {
      router.replace('/sign-in');
      return;
    }
    let cancelled = false;
    (async () => {
      // Authoritative role comes from the DB, not Clerk metadata, so a worker is
      // never routed into the owner dashboard.
      try {
        const auth = await authHeaders(getToken);
        const res = await api.get<{ role: string }>('/auth/me', auth);
        if (cancelled) return;
        if (res.data.role === 'WORKER') {
          router.replace('/worker');
          return;
        }
        // Owners/admins may keep using the preview override to open the worker area.
        router.replace(readRoleOverride() === 'WORKER' ? '/worker' : '/dashboard');
      } catch (err) {
        if (cancelled) return;
        const status = (err as { response?: { status?: number } })?.response?.status;
        // Authenticated but not authorized → dedicated unauthorized screen.
        router.replace(status === 403 ? '/unauthorized' : '/dashboard');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, getToken, router]);

  return null;
}
