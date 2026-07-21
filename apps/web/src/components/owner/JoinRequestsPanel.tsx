'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { CheckCircle2, XCircle, Loader2 } from 'lucide-react';
import Link from 'next/link';
import { api, authHeaders } from '../../lib/api';
import { SidePanel } from '../ui/SidePanel';

type PendingJoinRequest = {
  shiftId: string;
  requestedAt: string;
  workerName: string;
  jobId: string;
  jobType: 'PACKING' | 'UNPACKING' | 'HOME_ORGANIZATION';
  date: string;
  customerName: string;
  address: string;
};

const JOB_TYPE_HE: Record<string, string> = { PACKING: 'אריזה', UNPACKING: 'פריקה', HOME_ORGANIZATION: 'סידור' };

/**
 * Requires Attention side panel for pending worker join requests (spec item 8).
 * Opens directly from the Home banner and lets the owner Approve (assigns the
 * worker) or Reject inline — no navigation to a generic jobs board.
 */
export function JoinRequestsPanel({
  open,
  onClose,
  onChanged,
}: {
  open: boolean;
  onClose: () => void;
  onChanged?: () => void;
}) {
  const { getToken } = useAuth();
  const [rows, setRows] = useState<PendingJoinRequest[]>([]);
  const [loading, setLoading] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const auth = await authHeaders(getToken);
      const res = await api.get<PendingJoinRequest[]>('/admin/join-requests', auth);
      setRows(res.data ?? []);
    } catch {
      setError('לא ניתן לטעון בקשות הצטרפות.');
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    if (open) void load();
  }, [open, load]);

  const decide = useCallback(
    async (shiftId: string, approved: boolean) => {
      setBusyId(shiftId);
      setError(null);
      try {
        const auth = await authHeaders(getToken);
        await api.post(`/shifts/${shiftId}/approve`, { approved }, auth);
        setRows((prev) => prev.filter((r) => r.shiftId !== shiftId));
        onChanged?.();
      } catch (err) {
        const data = (err as { response?: { data?: { error?: string; message?: string } } })?.response?.data;
        setError(data?.message ?? data?.error ?? 'הפעולה נכשלה.');
      } finally {
        setBusyId(null);
      }
    },
    [getToken, onChanged],
  );

  return (
    <SidePanel open={open} onClose={onClose} title="בקשות הצטרפות">
      <div className="p-6 space-y-3" dir="rtl">
        {error && <p className="text-sm text-rose-700">{error}</p>}
        {loading ? (
          <p className="text-sm text-gray-500">טוען…</p>
        ) : rows.length === 0 ? (
          <p className="text-sm text-gray-500">אין בקשות הצטרפות ממתינות.</p>
        ) : (
          rows.map((r) => (
            <div key={r.shiftId} className="rounded-lg border border-gray-200 p-3">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="text-sm font-semibold text-gray-900">{r.workerName || 'עובד/ת'}</p>
                  <p className="text-xs text-gray-600 mt-0.5">
                    {JOB_TYPE_HE[r.jobType] ?? r.jobType} · {r.customerName || 'שריון כללי'} ·{' '}
                    {new Date(r.date).toLocaleDateString('he-IL')}
                  </p>
                  {r.address && <p className="text-[11px] text-gray-500 mt-0.5">{r.address}</p>}
                  <Link href={`/jobs/${r.jobId}`} className="text-[11px] text-primary-700 underline">
                    פתיחת העבודה
                  </Link>
                </div>
                <span className="text-[10px] text-gray-400 whitespace-nowrap">
                  {new Date(r.requestedAt).toLocaleDateString('he-IL')}
                </span>
              </div>
              <div className="mt-2 flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => void decide(r.shiftId, true)}
                  disabled={busyId === r.shiftId}
                  className="inline-flex items-center gap-1 rounded-lg bg-primary-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-primary-700 disabled:opacity-50"
                >
                  {busyId === r.shiftId ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <CheckCircle2 className="w-3.5 h-3.5" />}
                  אישור ושיבוץ
                </button>
                <button
                  type="button"
                  onClick={() => void decide(r.shiftId, false)}
                  disabled={busyId === r.shiftId}
                  className="inline-flex items-center gap-1 rounded-lg border border-rose-200 px-3 py-1.5 text-xs text-rose-700 hover:bg-rose-50 disabled:opacity-50"
                >
                  <XCircle className="w-3.5 h-3.5" />
                  דחייה
                </button>
              </div>
            </div>
          ))
        )}
      </div>
    </SidePanel>
  );
}
