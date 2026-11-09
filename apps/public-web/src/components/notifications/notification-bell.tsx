'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Bell } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useMediaQuery } from '@/lib/hooks/use-media-query';
import { useBellUser, useMarkRead, useNotifications, useNotificationsSummary } from '@/lib/hooks/use-notifications';
import { TodoList } from './todo-list';
import { NotificationList } from './notification-list';

export const notificationsHref = (role: string) => (role === 'CAREGIVER' ? '/caregiver/notifications' : '/account/notifications');

/** The number on the bell: 1-9, then 9+. */
export const badgeLabel = (n: number) => (n > 9 ? '9+' : String(n));

/**
 * The bell in the header, for signed-in clients and caregivers. Its number
 * is unread notifications plus things still to do. On a wide screen it opens
 * a panel; on a phone it goes to the full notifications page.
 */
export function NotificationBell() {
  const { t } = useTranslation();
  const user = useBellUser();
  const pathname = usePathname();
  const wide = useMediaQuery('(min-width: 768px)');
  const [open, setOpen] = useState(false);
  const panel = useRef<HTMLDivElement>(null);
  const { data } = useNotificationsSummary();

  // Close on a page change, a click outside, or Escape.
  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const click = (e: MouseEvent) => {
      if (panel.current && !panel.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', click);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', click);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  if (!user) return null;
  const count = data?.badge ?? 0;
  const label = count ? t('notifications.bellCount', { count }) : t('notifications.bell');
  const href = notificationsHref(user.role);
  const face = (
    <>
      <Bell className="h-5 w-5" aria-hidden />
      {count > 0 && (
        <span className="absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-600 px-1 text-[11px] font-bold leading-none text-white" aria-hidden>
          {badgeLabel(count)}
        </span>
      )}
    </>
  );
  const faceClass =
    'relative inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-ink/70 transition-colors hover:bg-brand-light hover:text-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand';

  if (!wide) {
    return (
      <Link href={href} aria-label={label} title={label} className={faceClass}>
        {face}
      </Link>
    );
  }

  return (
    <div ref={panel} className="relative">
      <button type="button" aria-label={label} title={label} aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)} className={faceClass}>
        {face}
      </button>
      {open && <BellPanel role={user.role} href={href} onClose={() => setOpen(false)} />}
    </div>
  );
}

function BellPanel({ role, href, onClose }: { role: string; href: string; onClose: () => void }) {
  const { t } = useTranslation();
  const summary = useNotificationsSummary();
  const list = useNotifications();
  const markRead = useMarkRead();
  const items = list.data?.pages.flatMap((p) => p.items).slice(0, 8) ?? [];
  const todos = summary.data?.todos ?? [];

  return (
    <div role="dialog" aria-label={t('notifications.title')} className="absolute right-0 top-12 z-30 w-[26rem] max-w-[calc(100vw-2rem)] rounded-xl border border-border bg-paper shadow-xl">
      <div className="max-h-[70vh] space-y-4 overflow-y-auto p-4">
        {todos.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wide text-ink/60">{t('notifications.todo')}</h2>
            <TodoList items={todos.slice(0, 5)} role={role} compact onOpen={onClose} />
          </section>
        )}
        <section>
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-ink/60">{t('notifications.recent')}</h2>
            {(summary.data?.unread ?? 0) > 0 && (
              <button type="button" onClick={() => markRead.mutate({ all: true })} className="min-h-9 text-sm font-medium text-brand hover:underline">
                {t('notifications.markAllRead')}
              </button>
            )}
          </div>
          {list.isError ? <p className="text-sm text-red-700">{t('notifications.loadError')}</p> : list.isLoading ? <p className="text-sm text-ink/60">{t('common.loading')}</p> : <NotificationList items={items} role={role} onOpen={onClose} />}
        </section>
      </div>
      <div className="border-t border-border p-2 text-center">
        <Link href={href} onClick={onClose} className="inline-flex min-h-11 items-center px-4 text-sm font-semibold text-brand hover:underline">
          {t('notifications.seeAll')}
        </Link>
      </div>
    </div>
  );
}
