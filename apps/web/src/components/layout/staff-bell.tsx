'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bell } from 'lucide-react';
import type { NotificationsPage } from '@care-platform/shared';
import { api } from '@/lib/api/client';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { fmtDateTime } from '@/lib/colombo-time';

/**
 * The staff bell: alerts from the agents (a visit not checked in, cover found
 * or not, documents not received, a file ready to verify, visits paused, a
 * request still incomplete) and people asking to talk to a person. The same
 * alerts are emailed; this is where nothing gets lost when an email is.
 * Polled once a minute; opening a notice marks it read.
 */
export function StaffBell() {
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const router = useRouter();
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const summary = useQuery({
    queryKey: ['staff-bell', 'summary'],
    queryFn: () => api.get<{ unread: number }>('/staff/notifications/summary'),
    enabled: Boolean(user),
    refetchInterval: 60_000,
  });
  const list = useQuery({ queryKey: ['staff-bell', 'list'], queryFn: () => api.get<NotificationsPage>('/staff/notifications'), enabled: open });
  const read = useMutation({
    mutationFn: (body: { ids?: string[]; all?: boolean }) => api.post('/staff/notifications/read', body),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['staff-bell'] }),
  });

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;
  const unread = summary.data?.unread ?? 0;
  const items = list.data?.items ?? [];

  return (
    <div ref={wrap} className="relative">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="true"
        aria-expanded={open}
        aria-label={unread ? t('staffBell.labelUnread', { n: unread }) : t('staffBell.label')}
        className="relative flex h-9 w-9 items-center justify-center rounded text-ink/60 hover:bg-paper hover:text-ink"
      >
        <Bell size={18} aria-hidden />
        {unread > 0 && (
          <span aria-hidden className="absolute -right-0.5 -top-0.5 flex min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-semibold leading-4 text-white">
            {unread > 99 ? '99+' : unread}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 z-40 mt-2 w-96 max-w-[90vw] rounded-lg border border-border bg-white shadow-lg" data-testid="staff-bell">
          <div className="flex items-center justify-between border-b border-border px-4 py-2">
            <p className="text-sm font-semibold text-ink">{t('staffBell.title')}</p>
            {unread > 0 && (
              <button type="button" className="text-xs font-medium text-brand hover:underline" onClick={() => read.mutate({ all: true })}>
                {t('staffBell.markAll')}
              </button>
            )}
          </div>
          <ul className="max-h-[60vh] overflow-y-auto">
            {list.isLoading && <li className="px-4 py-3 text-sm text-ink/50">{t('common.loading')}</li>}
            {!list.isLoading && items.length === 0 && <li className="px-4 py-3 text-sm text-ink/50">{t('staffBell.none')}</li>}
            {items.map((n) => (
              <li key={n.id}>
                <button
                  type="button"
                  className={`block w-full border-b border-border px-4 py-2.5 text-left hover:bg-paper ${n.readAt ? '' : 'bg-brand-light/40'}`}
                  onClick={() => {
                    if (!n.readAt) read.mutate({ ids: [n.id] });
                    setOpen(false);
                    if (n.path) router.push(n.path);
                  }}
                >
                  <span className="block text-sm font-medium text-ink">{n.title}</span>
                  <span className="block text-xs text-ink/70">{n.body}</span>
                  <span className="block text-[11px] text-ink/45">{fmtDateTime(n.createdAt, locale)}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
