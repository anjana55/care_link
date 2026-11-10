'use client';

import Link from 'next/link';
import { CalendarDays, CheckCircle2, ChevronRight, Heart, MessagesSquare, ReceiptText, Search, type LucideIcon } from 'lucide-react';
import type { NotificationCategory, TodoKind } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useBellUser, useNotificationsSummary } from '@/lib/hooks/use-notifications';
import { TodoList } from '@/components/notifications/todo-list';

interface Tile {
  key: 'find' | 'bookings' | 'bills' | 'saved' | 'requests';
  href: string;
  label: string;
  icon: LucideIcon;
  /** To-dos its number counts: what is waiting behind the card. */
  todos?: TodoKind[];
  /** Or unread notices of a kind: new replies from the office. */
  unread?: NotificationCategory;
}

/** The cards, in the order people most often need them - the same order, words and numbers as the app's home screen. */
const TILES: Tile[] = [
  { key: 'find', href: '/find', label: 'account.findCaregivers', icon: Search },
  { key: 'bookings', href: '/account/bookings', label: 'account.nav.bookings', icon: CalendarDays, todos: ['RATE_CAREGIVER', 'TICK_OFF_CARE'] },
  { key: 'bills', href: '/account/invoices', label: 'account.nav.invoices', icon: ReceiptText, todos: ['PAY_INVOICE'] },
  { key: 'requests', href: '/account/requests', label: 'account.nav.requests', icon: MessagesSquare, unread: 'REQUEST' },
  { key: 'saved', href: '/account/saved', label: 'account.nav.saved', icon: Heart },
];

/**
 * A client's home on the website - where "My account" lands. First what is
 * waiting on them, then one big card for each thing they can do, with a number
 * on it when something is waiting there. It mirrors the app's home screen, so
 * someone who uses both finds the same things in the same places.
 */
export default function AccountHomePage() {
  const { t } = useTranslation();
  const user = useBellUser();
  const { data, isLoading } = useNotificationsSummary();
  const todos = data?.todos ?? [];

  const countFor = (tile: Tile) => {
    if (tile.todos) return todos.filter((i) => tile.todos!.includes(i.kind)).length;
    return tile.unread ? (data?.unreadBy?.[tile.unread] ?? 0) : 0;
  };

  return (
    <div className="space-y-8">
      <div>
        <p className="text-sm text-ink/60">{t('clientHome.welcomeBack')}</p>
        {/* Their own name once the server sends it; a plain heading until then. */}
        <h1 className="text-2xl font-semibold text-ink">{data?.firstName || t('nav.myAccount')}</h1>
      </div>

      <section aria-labelledby="home-next">
        <h2 id="home-next" className="mb-2 text-lg font-semibold text-ink">
          {t('clientHome.nextForYou')}
        </h2>
        {isLoading ? (
          <p className="text-sm text-ink/60">{t('common.loading')}</p>
        ) : todos.length && user ? (
          <TodoList items={todos} role={user.role} />
        ) : (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-white p-4">
            <CheckCircle2 className="h-6 w-6 shrink-0 text-brand" aria-hidden />
            <p className="text-sm text-ink/70">{t('notifications.todoEmpty')}</p>
          </div>
        )}
      </section>

      <section aria-labelledby="home-do">
        <h2 id="home-do" className="mb-3 text-lg font-semibold text-ink">
          {t('clientHome.whatToDo')}
        </h2>
        <ul className="grid gap-3 sm:grid-cols-2">
          {TILES.map((tile) => {
            const count = countFor(tile);
            return (
              <li key={tile.key}>
                <Link
                  href={tile.href}
                  className="flex min-h-[5rem] items-center gap-4 rounded-lg border border-border bg-white p-4 transition-colors hover:border-brand/40 hover:bg-brand-light/40"
                >
                  <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand-dark">
                    <tile.icon className="h-6 w-6" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-base font-semibold text-ink">{t(tile.label)}</span>
                    <span className="block text-sm text-ink/60">{t(`clientHome.hints.${tile.key}`)}</span>
                  </span>
                  {count > 0 ? (
                    <span className="shrink-0 rounded-full bg-accent px-2.5 py-0.5 text-sm font-semibold tabular-nums text-white" aria-label={t('clientHome.waiting', { count })}>
                      {count}
                    </span>
                  ) : (
                    <ChevronRight className="h-5 w-5 shrink-0 text-ink/40" aria-hidden />
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </section>
    </div>
  );
}
