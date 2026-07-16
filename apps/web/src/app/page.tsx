'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useViewerRole } from '../lib/use-viewer-role';

export default function HomePage() {
  const router = useRouter();
  const role = useViewerRole();

  useEffect(() => {
    router.replace(role === 'WORKER' ? '/worker' : '/dashboard');
  }, [router, role]);

  return null;
}
