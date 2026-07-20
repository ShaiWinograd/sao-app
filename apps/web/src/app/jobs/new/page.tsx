'use client';

import { Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { ArrowRight, Plus } from 'lucide-react';
import { QuickCreateForm } from '../../../components/jobs/QuickCreateForm';

function NewJobInner() {
  const router = useRouter();
  const params = useSearchParams();
  const initialDate = params.get('date') ?? undefined;

  return (
    <div className="p-6 max-w-2xl" dir="rtl">
      <Link href="/jobs" className="inline-flex items-center gap-1 text-sm text-gray-500 hover:text-gray-700 mb-3">
        <ArrowRight className="w-4 h-4" />
        חזרה ליומן העבודות
      </Link>
      <h1 className="text-2xl font-bold text-gray-900 mb-1 flex items-center gap-2">
        <Plus className="w-6 h-6 text-primary-600" />
        עבודה חדשה
      </h1>
      <p className="text-sm text-gray-500 mb-5">שריון עובדים לתאריך. ניתן ליצור עם לקוח קיים, לקוח חדש, או שריון כללי.</p>

      <QuickCreateForm
        initialDate={initialDate}
        onCreated={(id) => router.push(`/jobs/${id}`)}
        onCancel={() => router.push('/jobs')}
      />
    </div>
  );
}

export default function NewJobPage() {
  return (
    <Suspense fallback={<div className="p-6 text-sm text-gray-400">טוען…</div>}>
      <NewJobInner />
    </Suspense>
  );
}
