import type { NotificationCategory, TodoKind } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { useNotificationsSummary } from './api';

/**
 * How many things are waiting, for the numbers on the tab bar and on menu
 * rows. Read from the bell's summary - the same data as the bell and Home's
 * cards, already fetched and kept fresh - so every number in the app agrees.
 * Zero when signed out or before the summary loads.
 */
export function useWaitingCounts() {
  const { data } = useNotificationsSummary();
  const todos = data?.todos ?? [];
  return {
    todos: (...kinds: TodoKind[]) => todos.filter((i) => kinds.includes(i.kind)).length,
    unread: (category: NotificationCategory) => data?.unreadBy?.[category] ?? 0,
  };
}

/**
 * Tab options for a tab with `count` things waiting behind it: the number on
 * the icon, and said aloud after the tab's name. Nothing when there are none.
 */
export function useTabBadge() {
  const { t } = useTranslation();
  const colors = useColors();
  return (label: string, count: number) =>
    count > 0
      ? {
          tabBarBadge: count,
          tabBarBadgeStyle: { backgroundColor: colors.accent, color: '#fff', fontSize: 12, fontWeight: '700' as const },
          tabBarAccessibilityLabel: `${label}, ${t('clientHome.waiting', { count })}`,
        }
      : {};
}
