'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useSearchParams } from 'next/navigation';
import { Phone, Mail, Briefcase, MapPin, Pencil, Check, X, CalendarDays, Landmark, Home } from 'lucide-react';
import { api, authHeaders } from '../../../lib/api';
import { PageHeader } from '../../../components/ui/PageHeader';

type WorkerProfile = {
  id: string;
  firstName?: string;
  lastName?: string;
  phone?: string;
  email?: string;
  skills?: string[];
  homeArea?: string | null;
  homeAddress?: string | null;
  birthday?: string | null;
  bankNumber?: string | null;
  bankBranch?: string | null;
  bankAccountNumber?: string | null;
  bankAccountHolder?: string | null;
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
  const searchParams = useSearchParams();
  const editQueryHandled = useRef(false);
  const [profile, setProfile] = useState<WorkerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [homeArea, setHomeArea] = useState('');
  const [homeAddress, setHomeAddress] = useState('');
  const [birthday, setBirthday] = useState('');
  const [bankNumber, setBankNumber] = useState('');
  const [bankBranch, setBankBranch] = useState('');
  const [bankAccountNumber, setBankAccountNumber] = useState('');
  const [bankAccountHolder, setBankAccountHolder] = useState('');

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
    setHomeAddress(profile.homeAddress ?? '');
    setBirthday(profile.birthday?.slice(0, 10) ?? '');
    setBankNumber(profile.bankNumber ?? '');
    setBankBranch(profile.bankBranch ?? '');
    setBankAccountNumber(profile.bankAccountNumber ?? '');
    setBankAccountHolder(profile.bankAccountHolder ?? '');
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
        {
          phone: phone.trim(),
          email: email.trim(),
          homeArea: homeArea.trim(),
          homeAddress: homeAddress.trim(),
          birthday,
          bankNumber: bankNumber.trim(),
          bankBranch: bankBranch.trim(),
          bankAccountNumber: bankAccountNumber.trim(),
          bankAccountHolder: bankAccountHolder.trim(),
        },
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
  }, [profile, phone, email, homeArea, homeAddress, birthday, bankNumber, bankBranch, bankAccountNumber, bankAccountHolder, getToken]);

  useEffect(() => {
    if (profile && searchParams.get('action') === 'edit' && !editQueryHandled.current) {
      editQueryHandled.current = true;
      startEdit();
    }
  }, [profile, searchParams, startEdit]);

  if (loading) return <p className="text-sm text-gray-400">טוען…</p>;

  return (
    <div className="mx-auto w-full max-w-[960px] space-y-6">
      <PageHeader
        eyebrow="THIS IS YOUR SPACE"
        title="נעים להכיר"
        description="פרטי הקשר והמידע שמלווה אותך בעבודה."
        icon={<Briefcase className="h-6 w-6" />}
        action={profile && !editing ? (
          <button
            type="button"
            onClick={startEdit}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-[var(--color-surface-muted)]"
          >
            <Pencil className="h-4 w-4" />
            עריכה
          </button>
        ) : undefined}
      />

      {error || !profile ? (
        <p className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 text-sm text-gray-500">
          לא נמצא פרופיל עובד/ת לחשבון זה.
        </p>
      ) : (
        <div className="space-y-6 border-y border-[var(--color-border)] py-7">
          <div className="grid gap-5 sm:grid-cols-[6rem_minmax(0,1fr)] sm:items-center">
            <div className="font-display flex h-24 w-24 items-center justify-center bg-primary-100 text-4xl text-primary-700">
              {(profile.firstName?.[0] ?? '') + (profile.lastName?.[0] ?? '') || 'S&O'}
            </div>
            <div>
              <p className="font-display text-2xl font-medium text-gray-900">
              {`${profile.firstName ?? ''} ${profile.lastName ?? ''}`.trim() || 'עובד/ת'}
              </p>
              {!editing && profile.homeArea && <p className="mt-1 text-sm text-[var(--color-text-secondary)]">{profile.homeArea}</p>}
            </div>
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
              <label className="block text-xs text-gray-600">
                כתובת מגורים
                <input type="text" value={homeAddress} onChange={(e) => setHomeAddress(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </label>
              <label className="block text-xs text-gray-600">
                תאריך לידה
                <input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} className="mt-1 block w-full rounded-lg border border-gray-300 px-3 py-2 text-sm" />
              </label>
              <fieldset className="grid grid-cols-2 gap-3 border-y border-[var(--color-border)] py-3">
                <legend className="px-2 text-xs font-semibold text-gray-700">חשבון בנק</legend>
                <input value={bankAccountHolder} onChange={(e) => setBankAccountHolder(e.target.value)} className="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="שם בעלת החשבון" />
                <input value={bankNumber} onChange={(e) => setBankNumber(e.target.value.replace(/\D/g, '').slice(0, 3))} inputMode="numeric" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="מספר בנק" />
                <input value={bankBranch} onChange={(e) => setBankBranch(e.target.value.replace(/\D/g, '').slice(0, 5))} inputMode="numeric" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="מספר סניף" />
                <input value={bankAccountNumber} onChange={(e) => setBankAccountNumber(e.target.value.replace(/\D/g, '').slice(0, 20))} inputMode="numeric" className="rounded-lg border border-gray-300 px-3 py-2 text-sm" placeholder="מספר חשבון" />
              </fieldset>
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
                  className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-3 py-2 text-xs font-medium text-gray-700 hover:bg-[var(--color-surface-muted)] disabled:opacity-50"
                >
                  <X className="w-3.5 h-3.5" />
                  ביטול
                </button>
              </div>
            </div>
          ) : (
            <div className="divide-y divide-[var(--color-border)] border-t border-[var(--color-border)] text-sm text-gray-700">
              {profile.phone && (
                <p className="flex items-center justify-between gap-4 py-4">
                  <span className="text-[var(--color-text-secondary)]">טלפון</span>
                  <span className="flex items-center gap-2"><Phone className="w-4 h-4 text-gray-400" />{profile.phone}</span>
                </p>
              )}
              {profile.email && (
                <p className="flex items-center justify-between gap-4 py-4">
                  <span className="text-[var(--color-text-secondary)]">אימייל</span>
                  <span className="flex items-center gap-2"><Mail className="w-4 h-4 text-gray-400" />{profile.email}</span>
                </p>
              )}
              {profile.homeArea && (
                <p className="flex items-center justify-between gap-4 py-4">
                  <span className="text-[var(--color-text-secondary)]">אזור עבודה</span>
                  <span className="flex items-center gap-2"><MapPin className="w-4 h-4 text-gray-400" />{profile.homeArea}</span>
                </p>
              )}
              {profile.homeAddress && (
                <p className="flex items-center justify-between gap-4 py-4">
                  <span className="text-[var(--color-text-secondary)]">כתובת מגורים</span>
                  <span className="flex items-center gap-2"><Home className="h-4 w-4 text-gray-400" />{profile.homeAddress}</span>
                </p>
              )}
              {profile.birthday && (
                <p className="flex items-center justify-between gap-4 py-4">
                  <span className="text-[var(--color-text-secondary)]">תאריך לידה</span>
                  <span className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-gray-400" />{new Date(profile.birthday).toLocaleDateString('he-IL')}</span>
                </p>
              )}
              {profile.bankAccountNumber && (
                <p className="flex items-center justify-between gap-4 py-4">
                  <span className="text-[var(--color-text-secondary)]">חשבון בנק</span>
                  <span className="flex items-center gap-2 text-left"><Landmark className="h-4 w-4 text-gray-400" />בנק {profile.bankNumber} · סניף {profile.bankBranch} · {profile.bankAccountNumber}</span>
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
