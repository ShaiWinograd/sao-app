'use client';

import { useParams } from 'next/navigation';
import { OwnerJobDetail } from '../../../components/jobs/OwnerJobDetail';

export default function JobDetailPage() {
  const params = useParams<{ id: string }>();
  return <OwnerJobDetail jobId={params.id} />;
}
