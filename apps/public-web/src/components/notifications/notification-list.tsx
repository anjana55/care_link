'use client';

import Link from 'next/link';
import { Bell, CalendarDays, ClipboardCheck, FileText, Megaphone, MessageSquare, Receipt, Star, Wallet } from 'lucide-react';
import { webPathFor, type NotificationCategory, type NotificationItem } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { fmtDateTime } from '@/lib/colombo-time';
import { useMarkRead } from '@/lib/hooks/use-notifications';
import { cn } from '@/lib/utils';

const ICONS: Record<NotificationCategory, typeof Bell> = {
  BOOKING: CalendarDays,
  REQUEST: MessageSquare,
  INVOICE: Receipt,
  PAYOUT: Wallet,
  REVIEW: Star,
  CARE: ClipboardCheck,
  DOCUMENT: FileText,
  ANNOUNCEMENT: Megaphone,
  REMINDER: Bell,
  OTHER: Bell,
};

/** Unread important notices first, then newest first (the API already sends newest first). */
export function pinImportant(items: NotificationItem[]): NotificationItem[] {
  const pinned = items.filter((i) => i.important && !i.readAt);
  return [...pinned, ...items.filter((i) => !(i.important && !i.readAt))];
}

/** An announcement's own link: a page on this site, or an outside https address (opened in a new tab). */
function OwnLink({ href, label }: { href: string; label: string }) {
  if (href.startsWith('/')) {
    return (
      <Link href={href} className="mt-1 inline-block text-sm font-medium text-brand hover:underline">
        {label}
      </Link>
    );
  }
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="mt-1 inline-block text-sm font-medium text-brand hover:underline">
      {label}
    </a>
  );
}

/**
 * The notifications history. Each one opens the page it is about and is
 * marked read; an announcement with nowhere to go is marked read when tapped.
 */
export function NotificationList({ items, role, onOpen }: { items: NotificationItem[]; role: string; onOpen?: () => void }) {
  const { t, locale } = useTranslation();
  const markRead = useMarkRead();
  if (!items.length) return <p className="py-2 text-sm text-ink/60">{t('notifications.empty')}</p>;

  return (
    <ul className="divide-y divide-border rounded-lg border border-border bg-white">
      {pinImportant(items).map((item) => {
        const Icon = ICONS[item.category] ?? Bell;
        const unread = !item.readAt;
        const open = () => {
          if (unread) markRead.mutate({ ids: [item.id] });
          onOpen?.();
        };
        const goesSomewhere = item.path !== '/notifications';
        const body = (
          <>
            <span className={cn('mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full', unread ? 'bg-brand-light text-brand-dark' : 'bg-paper text-ink/50')}>
              <Icon className="h-4 w-4" aria-hidden />
            </span>
            <span className="min-w-0 flex-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className={cn('text-sm text-ink', unread ? 'font-semibold' : 'font-medium')}>{item.title}</span>
                {item.important && unread && (
                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-semibold text-amber-800">{t('notifications.important')}</span>
                )}
                {unread && <span className="sr-only">{t('notifications.new')}</span>}
              </span>
              <span className="mt-0.5 block whitespace-pre-line text-sm text-ink/70">{item.body}</span>
              <span className="mt-1 block text-xs text-ink/50">{fmtDateTime(item.createdAt, locale)}</span>
            </span>
            {unread && <span className="mt-2 h-2.5 w-2.5 shrink-0 rounded-full bg-brand" aria-hidden />}
          </>
        );
        return (
          <li key={item.id} className={cn(unread && 'bg-brand-light/30')}>
            {goesSomewhere ? (
              <Link href={webPathFor(item.path, role)} onClick={open} className="flex gap-3 p-3 hover:bg-paper focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand">
                {body}
              </Link>
            ) : (
              <div className="p-3">
                <button type="button" onClick={open} className="flex w-full gap-3 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
                  {body}
                </button>
                {item.link && (
                  <div className="pl-12">
                    <OwnLink href={item.link} label={t('notifications.openLink')} />
                  </div>
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
