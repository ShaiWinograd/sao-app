'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@clerk/nextjs';
import { api, authHeaders } from '../../lib/api';

/**
 * Redirects a WORKER-role account away from the owner dashboard. The role is
 * read from the authoritative DB endpoint (not Clerk metadata), so a worker can
 * never land on or linger in the owner view — even via a direct URL.
 */
export default function WorkerRedirectGuard() {
  const router = useRouter();
  const { isLoaded, isSignedIn, getToken } = useAuth();

  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    (async () => {
      try {
        const auth = await authHeaders(getToken);
        const res = await api.get<{ role: string }>('/auth/me', auth);
        if (!cancelled && res.data.role === 'WORKER') router.replace('/worker');
      } catch {
        // On error, leave the owner shell in place rather than misrouting.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isLoaded, isSignedIn, getToken, router]);

  return null;
}
