'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { Bell, Check } from 'lucide-react';
import { api, authHeaders } from '../../../lib/api';

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
    <div className="space-y-4 max-w-3xl">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h1 className="text-xl font-bold text-gray-900">התראות</h1>
          <p className="text-sm text-gray-500 mt-0.5">עדכונים על עבודות, שיבוצים ומשמרות.</p>
        </div>
        {hasUnread && (
          <button
            type="button"
            onClick={() => void markAllRead()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-gray-300 bg-white px-3 py-1.5 text-xs font-medium text-gray-700 hover:bg-gray-50"
          >
            <Check className="w-3.5 h-3.5" />
            סמן הכל כנקרא
          </button>
        )}
      </div>

      {items.length === 0 ? (
        <div className="rounded-xl border border-gray-200 bg-white p-8 text-center">
          <Bell className="mx-auto w-7 h-7 text-gray-300" />
          <p className="mt-2 text-sm text-gray-500">אין התראות כרגע.</p>
        </div>
      ) : (
        <div className="space-y-1.5">
          {items.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => !n.isRead && void markRead(n.id)}
              className={`block w-full rounded-lg border px-3 py-2.5 text-right ${
                n.isRead ? 'border-gray-200 bg-white' : 'border-primary-200 bg-primary-50'
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
