'use client';

import { useCallback, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { AlertTriangle, CheckCircle2, MapPin, RefreshCw } from 'lucide-react';
import { geocodeReasonExplanation, geocodeStatusLabel, isRetryableGeocodeReason } from '@workforce/shared';
import { api, authHeaders } from '../../lib/api';

type Props = {
  addressId: string;
  status?: string | null;
  reason?: string | null;
  normalizedAddress?: string | null;
  fullAddress?: string | null;
  /** Called after a successful re-validation so the caller can refetch. */
  onChanged?: () => void | Promise<unknown>;
};

const TONE: Record<string, string> = {
  RESOLVED: 'border-emerald-200 bg-emerald-50 text-emerald-800',
  NEEDS_REVIEW: 'border-amber-200 bg-amber-50 text-amber-800',
  FAILED: 'border-rose-200 bg-rose-50 text-rose-800',
  NOT_REQUESTED: 'border-gray-200 bg-gray-50 text-gray-600',
};

/**
 * Owner-facing address validation state (PBI #217, PR-4). Shows the monitoring
 * state, a plain explanation for NEEDS_REVIEW/FAILED, the normalized address,
 * and a retry/correct action. Never exposes coordinates, confidence, or raw
 * error codes. Purely presentational + a retry call — no geofence behavior.
 */
export default function AddressGeocodeState({ addressId, status, reason, normalizedAddress, fullAddress, onChanged }: Props) {
  const { getToken } = useAuth();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  const s = status ?? 'NOT_REQUESTED';
  const active = s === 'RESOLVED';
  const explanation = geocodeReasonExplanation(reason);
  const retryable = isRetryableGeocodeReason(reason);
  const showNormalized = Boolean(normalizedAddress && normalizedAddress !== fullAddress);

  const retry = useCallback(async () => {
    setBusy(true);
    setError(false);
    try {
      const auth = await authHeaders(getToken);
      await api.post(`/addresses/${addressId}/geocode`, {}, auth);
      await onChanged?.();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }, [addressId, getToken, onChanged]);

  return (
    <div className={`rounded-lg border px-3 py-2 text-[12px] ${TONE[s] ?? TONE.NOT_REQUESTED}`}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 font-semibold">
          {active ? <CheckCircle2 className="h-4 w-4 shrink-0" /> : <AlertTriangle className="h-4 w-4 shrink-0" />}
          {geocodeStatusLabel(s)}
        </span>
        {!active && (
          <button
            type="button"
            onClick={retry}
            disabled={busy}
            className="inline-flex items-center gap-1 rounded-md border border-black/10 bg-white/50 px-2 py-0.5 font-medium hover:bg-white disabled:opacity-50"
          >
            <RefreshCw className={`h-3.5 w-3.5 ${busy ? 'animate-spin' : ''}`} />
            {retryable ? 'נסה שוב' : 'בדיקת מיקום מחדש'}
          </button>
        )}
      </div>

      {!active && (
        <p className="mt-1">ניטור מיקום (כניסה/יציאה מהאזור) אינו פעיל עד לאימות הכתובת. הנוכחות תיבדק ידנית לפי הצורך.</p>
      )}
      {explanation && <p className="mt-1">{explanation}</p>}
      {!active && !retryable && s !== 'NOT_REQUESTED' && (
        <p className="mt-1">כדאי לתקן את הכתובת בפרטי העבודה ואז לבדוק שוב.</p>
      )}
      {showNormalized && (
        <p className="mt-1 inline-flex items-center gap-1 text-gray-600">
          <MapPin className="h-3.5 w-3.5 shrink-0" />
          <span>
            כתובת מנורמלת: <span className="font-medium text-gray-900">{normalizedAddress}</span>
          </span>
        </p>
      )}
      {error && <p className="mt-1 font-medium text-rose-700">אירעה שגיאה בבדיקת המיקום. נסו שוב.</p>}
    </div>
  );
}
