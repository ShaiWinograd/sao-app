'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Phone, Mail, Briefcase, MapPin, Pencil, Check, X } from 'lucide-react';
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

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [homeArea, setHomeArea] = useState('');

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

  const startEdit = useCallback(() => {
    if (!profile) return;
    setPhone(profile.phone ?? '');
    setEmail(profile.email ?? '');
    setHomeArea(profile.homeArea ?? '');
    setMsg(null);
    setEditing(true);
  }, [profile]);

  const save = useCallback(async () => {
    if (!profile) return;
    if (phone.trim().length < 9) {
      setMsg('מספר טלפון לא תקין.');
      return;
    }
    setSaving(true);
    setMsg(null);
    try {
      const auth = await authHeaders(getToken);
      const res = await api.patch<WorkerProfile>(
        '/workers/me',
        { phone: phone.trim(), email: email.trim(), homeArea: homeArea.trim() },
        auth,
      );
      setProfile(res.data);
      setEditing(false);
    } catch (err) {
      const status = (err as { response?: { status?: number } })?.response?.status;
      setMsg(status === 409 ? 'כתובת האימייל כבר בשימוש.' : 'השמירה נכשלה. נסי שוב.');
    } finally {
      setSaving(false);
    }
  }, [profile, phone, email, homeArea, getToken]);

  if (loading) return <p className="text-sm text-gray-400">טוען…</p>;

  return (
    <div className="space-y-4 max-w-2xl">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-gray-900">הפרופיל שלי</h1>
        {profile && !editing && (
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <Pencil className="w-3.5 h-3.5" />
            עריכה
          </button>
        )}
      </div>

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
            {!editing && profile.homeArea && <p className="text-xs text-gray-500 mt-0.5">אזור: {profile.homeArea}</p>}
          </div>

          {editing ? (
            <div className="space-y-3">
              <label className="block text-xs text-gray-600">
                טלפון
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-gray-600">
                אימייל
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              <label className="block text-xs text-gray-600">
                אזור מגורים
                <input
                  type="text"
                  value={homeArea}
                  onChange={(e) => setHomeArea(e.target.value)}
                  className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm"
                />
              </label>
              {msg && <p className="text-xs text-rose-600">{msg}</p>}
              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-3 py-2 text-xs font-semibold text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  <Check className="w-3.5 h-3.5" />
                  שמירה
                </button>
                <button
                  type="button"
                  onClick={() => setEditing(false)}
                  disabled={saving}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-medium text-gray-700 hover:bg-gray-50 disabled:opacity-50"
                >
                  <X className="w-3.5 h-3.5" />
                  ביטול
                </button>
              </div>
            </div>
          ) : (
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
              {profile.homeArea && (
                <p className="flex items-center gap-2">
                  <MapPin className="w-4 h-4 text-gray-400" />
                  {profile.homeArea}
                </p>
              )}
            </div>
          )}

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
