'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Bell, Check } from 'lucide-react';
import { api, authHeaders } from '../../../lib/api';
import { EmptyState } from '../../../components/ui/EmptyState';
import { PageHeader } from '../../../components/ui/PageHeader';

type Notification = { id: string; title: string; body: string; isRead: boolean; sentAt: string };

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function WorkerNotificationsPage() {
  const { getToken } = useAuth();
  const [items, setItems] = useState<Notification[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    try {
      const auth = await authHeaders(getToken);
      const res = await api.get<Notification[]>('/notifications/mine', auth);
      setItems(res.data ?? []);
    } catch {
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [getToken]);

  useEffect(() => {
    void load();
  }, [load]);

  const markRead = useCallback(
    async (id: string) => {
      setItems((prev) => prev.map((n) => (n.id === id ? { ...n, isRead: true } : n)));
      try {
        const auth = await authHeaders(getToken);
        await api.post(`/notifications/${id}/read`, {}, auth);
      } catch {
        /* optimistic; ignore */
      }
    },
    [getToken],
  );

  const markAllRead = useCallback(async () => {
    setItems((prev) => prev.map((n) => ({ ...n, isRead: true })));
    try {
      const auth = await authHeaders(getToken);
      await api.post('/notifications/read-all', {}, auth);
    } catch {
      /* optimistic; ignore */
    }
  }, [getToken]);

  const hasUnread = items.some((n) => !n.isRead);

  if (loading) return <p className="text-sm text-gray-400">טוען…</p>;

  return (
    <div className="mx-auto w-full max-w-[960px] space-y-6">
      <PageHeader
        eyebrow="מרכז העדכונים"
        title="התראות"
        description="עדכונים על עבודות, שיבוצים ומשמרות."
        icon={<Bell className="h-6 w-6" />}
        action={hasUnread ? (
          <button
            type="button"
            onClick={() => void markAllRead()}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[#d8d3ca] bg-white px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-gray-50"
          >
            <Check className="h-4 w-4" />
            סמן הכל כנקרא
          </button>
        ) : undefined}
      />

      {items.length === 0 ? (
        <EmptyState
          icon={<Bell className="h-7 w-7" />}
          title="הכול מעודכן"
          description="התראות חדשות על עבודות, שיבוצים ושינויים יופיעו כאן."
        />
      ) : (
        <div className="space-y-3">
          {items.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => !n.isRead && void markRead(n.id)}
              className={`block w-full rounded-2xl border px-5 py-4 text-right shadow-[0_2px_10px_rgba(38,38,38,0.035)] transition-all hover:-translate-y-0.5 hover:shadow-[0_8px_24px_rgba(38,38,38,0.06)] ${
                n.isRead ? 'border-[#e7e3dc] bg-white' : 'border-primary-200 bg-primary-50'
              }`}
            >
              <div className="flex items-start justify-between gap-2">
                <p className="text-xs font-semibold text-gray-900">{n.title}</p>
                {!n.isRead && <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-primary-500" />}
              </div>
              <p className="text-xs text-gray-600 mt-0.5">{n.body}</p>
              <p className="text-[11px] text-gray-400 mt-1">{formatWhen(n.sentAt)}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
