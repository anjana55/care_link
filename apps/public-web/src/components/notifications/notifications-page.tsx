'use client';

import { useTranslation } from '@/lib/i18n';
import { useBellUser, useMarkRead, useNotifications, useNotificationsSummary } from '@/lib/hooks/use-notifications';
import { Button } from '@/components/ui/button';
import { TodoList } from './todo-list';
import { NotificationList } from './notification-list';

/** The full notifications page for a client or caregiver: To do, then the history, older ones on request. */
export function NotificationsPage() {
  const { t } = useTranslation();
  const user = useBellUser();
  const summary = useNotificationsSummary();
  const list = useNotifications();
  const markRead = useMarkRead();
  if (!user) return null;
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold text-ink">{t('notifications.title')}</h1>
      <section aria-labelledby="todo-heading">
        <h2 id="todo-heading" className="mb-2 text-lg font-semibold text-ink">{t('notifications.todo')}</h2>
        {summary.isLoading ? <p className="text-sm text-ink/60">{t('common.loading')}</p> : <TodoList items={summary.data?.todos ?? []} role={user.role} />}
      </section>
      <section aria-labelledby="history-heading">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 id="history-heading" className="text-lg font-semibold text-ink">{t('notifications.recent')}</h2>
          {(summary.data?.unread ?? 0) > 0 && (
            <Button variant="secondary" size="sm" onClick={() => markRead.mutate({ all: true })} disabled={markRead.isPending}>
              {t('notifications.markAllRead')}
            </Button>
          )}
        </div>
        {list.isError ? (
          <p className="text-sm text-red-700">{t('notifications.loadError')}</p>
        ) : list.isLoading ? (
          <p className="text-sm text-ink/60">{t('common.loading')}</p>
        ) : (
          <NotificationList items={items} role={user.role} />
        )}
        {list.hasNextPage && (
          <div className="mt-3 text-center">
            <Button variant="secondary" onClick={() => list.fetchNextPage()} disabled={list.isFetchingNextPage}>
              {t('notifications.loadMore')}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}

/** To do as cards at the top of a client's or caregiver's landing page. Shows nothing when there is nothing to do. */
export function TodoCards() {
  const { t } = useTranslation();
  const user = useBellUser();
  const { data } = useNotificationsSummary();
  if (!user || !data?.todos.length) return null;
  return (
    <section aria-labelledby="todo-cards" className="mb-6">
      <h2 id="todo-cards" className="mb-2 text-lg font-semibold text-ink">{t('notifications.todo')}</h2>
      <TodoList items={data.todos} role={user.role} />
    </section>
  );
}
