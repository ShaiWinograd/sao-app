'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Phone, Mail, Briefcase } from 'lucide-react';
import { api, authHeaders } from '../../../lib/api';

type WorkerProfile = {
  id: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  skills?: string[];
  homeArea?: string | null;
};

const SKILL_LABEL: Record<string, string> = {
  SHIFT_LEADER: 'ראש צוות',
  PACKING_SPECIALIST: 'מומחית אריזה',
  UNPACKING_SPECIALIST: 'מומחית פריקה',
  ORGANIZATION_SPECIALIST: 'מומחית סידור',
  GENERAL_WORKER: 'עובדת כללית',
  DRIVER: 'נהגת',
};

export default function WorkerProfilePage() {
  const { getToken } = useAuth();
  const [profile, setProfile] = useState<WorkerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const auth = await authHeaders(getToken);
        const res = await api.get<WorkerProfile>('/workers/me', auth);
        setProfile(res.data);
      } catch {
        setError(true);
      } finally {
        setLoading(false);
      }
    })();
  }, [getToken]);

  if (loading) return <p className="text-sm text-gray-400">טוען…</p>;

  return (
    <div className="space-y-4 max-w-2xl">
      <h1 className="text-xl font-bold text-gray-900">הפרופיל שלי</h1>

      {error || !profile ? (
        <p className="rounded-xl border border-gray-200 bg-white p-4 text-sm text-gray-500">
          לא נמצא פרופיל עובד/ת לחשבון זה.
        </p>
      ) : (
        <div className="rounded-xl border border-gray-200 bg-white p-4 space-y-3">
          <div>
            <p className="text-lg font-bold text-gray-900">
              {`${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim() || 'עובד/ת'}
            </p>
            {profile.homeArea && <p className="text-xs text-gray-500 mt-0.5">אזור: {profile.homeArea}</p>}
          </div>

          <div className="space-y-1.5 text-sm text-gray-700">
            {profile.phone && (
              <p className="flex items-center gap-2">
                <Phone className="w-4 h-4 text-gray-400" />
                {profile.phone}
              </p>
            )}
            {profile.email && (
              <p className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-gray-400" />
                {profile.email}
              </p>
            )}
          </div>

          {(profile.skills ?? []).length > 0 && (
            <div>
              <p className="flex items-center gap-2 text-xs font-semibold text-gray-600 mb-1.5">
                <Briefcase className="w-4 h-4 text-gray-400" />
                תפקידים
              </p>
              <div className="flex flex-wrap gap-1.5">
                {(profile.skills ?? []).map((s) => (
                  <span key={s} className="rounded-full border border-gray-200 bg-gray-50 px-2.5 py-0.5 text-[11px] text-gray-700">
                    {SKILL_LABEL[s] ?? s}
                  </span>
                ))}
              </div>
            </div>
          )}

          <p className="text-xs text-gray-400 pt-1">התעריף השעתי והדוחות החודשיים יופיעו בעמוד "הדוחות שלי".</p>
        </div>
      )}
    </div>
  );
}
