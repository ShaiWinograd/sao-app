'use client';

import { useEffect } from 'react';
import { useAuth } from '@clerk/nextjs';

export function ClerkTokenProvider() {
  const { getToken } = useAuth();

  useEffect(() => {
    // No-op: token injection now done via window.Clerk.session.getToken() in api.ts
  }, [getToken]);

  return null;
}
