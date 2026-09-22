'use client';

import { useCallback, useEffect, useState } from 'react';
import { useAuth } from '@clerk/nextjs';
import { useRouter } from 'next/navigation';
import { Bell, Check } from 'lucide-react';
import { api, authHeaders } from '../../../lib/api';
import { EmptyState } from '../../../components/ui/EmptyState';
import { PageHeader } from '../../../components/ui/PageHeader';

type Notification = {
  id: string;
  title: string;
  body: string;
  isRead: boolean;
  sentAt: string;
  data?: { shiftId?: string; jobId?: string } | null;
};

function formatWhen(iso: string): string {
  try {
    return new Date(iso).toLocaleString('he-IL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

export default function WorkerNotificationsPage() {
  const { getToken } = useAuth();
  const router = useRouter();
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

  const openNotification = useCallback(async (notification: Notification) => {
    if (!notification.isRead) await markRead(notification.id);
    if (notification.data?.shiftId) {
      router.push(`/worker/shifts/${notification.data.shiftId}`);
    } else if (notification.data?.jobId) {
      router.push('/worker');
    }
  }, [markRead, router]);

  if (loading) return <p className="text-sm text-gray-400">טוען…</p>;

  return (
    <div className="mx-auto w-full max-w-[960px] space-y-6">
      <PageHeader
        eyebrow="STAY IN THE LOOP"
        title="מה חדש"
        description="עדכונים על עבודות, שיבוצים ושינויים שחשוב להכיר."
        icon={<Bell className="h-6 w-6" />}
        action={hasUnread ? (
          <button
            type="button"
            onClick={() => void markAllRead()}
            className="inline-flex min-h-11 items-center gap-2 rounded-xl border border-[var(--color-border-strong)] bg-[var(--color-surface)] px-4 py-2 text-sm font-semibold text-gray-700 shadow-sm hover:bg-[var(--color-surface-muted)]"
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
        <div className="divide-y divide-[var(--color-border)] border-y border-[var(--color-border)]">
          {items.map((n) => (
            <button
              key={n.id}
              type="button"
              onClick={() => void openNotification(n)}
              className={`grid w-full grid-cols-[0.75rem_minmax(0,1fr)_auto] items-start gap-4 px-2 py-5 text-right transition-colors hover:bg-primary-50/50 ${
                n.isRead ? '' : 'bg-primary-50/40'
              }`}
            >
              <span className={`mt-2 h-2 w-2 rounded-full ${n.isRead ? 'bg-[var(--color-border-strong)]' : 'bg-primary-600'}`} />
              <div>
                <p className="text-sm font-semibold text-gray-900">{n.title}</p>
                <p className="mt-1 text-sm leading-6 text-[var(--color-text-secondary)]">{n.body}</p>
                {(n.data?.shiftId || n.data?.jobId) && (
                  <p className="mt-2 text-xs font-semibold text-primary-700">
                    {n.data.shiftId ? 'פתיחת המשמרת' : 'פתיחת היומן'} ←
                  </p>
                )}
              </div>
              <p className="text-[11px] text-[var(--color-text-muted)]">{formatWhen(n.sentAt)}</p>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
