import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button } from '@/ui/controls';
import { PageHeader } from '@/ui/PageHeader';
import { Text } from '@/ui/Text';
import { notificationsKey, useBellUser, useMarkRead, useNotifications, useNotificationsSummary } from '@/notifications/api';
import { NotificationList, TodoList } from '@/notifications/Lists';

/** The bell's screen: To do first, then every notification, older ones on request. */
export default function NotificationsScreen() {
  const { t } = useTranslation();
  const colors = useColors();
  const queryClient = useQueryClient();
  const user = useBellUser();
  const summary = useNotificationsSummary();
  const list = useNotifications();
  const markRead = useMarkRead();
  const items = list.data?.pages.flatMap((p) => p.items) ?? [];

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={{ paddingBottom: 40 }}
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void queryClient.invalidateQueries({ queryKey: notificationsKey(user?.userId) })} />}
      >
        <PageHeader title={t('notifications.title')} />
        <View style={styles.body}>
          <Text accessibilityRole="header" style={[styles.section, { color: colors.deep }]}>
            {t('notifications.todo')}
          </Text>
          {summary.isLoading ? <Text style={{ fontSize: 17, color: colors.muted }}>{t('common.loading')}</Text> : <TodoList items={summary.data?.todos ?? []} />}

          <Text accessibilityRole="header" style={[styles.section, { color: colors.deep, marginTop: 12 }]}>
            {t('notifications.recent')}
          </Text>
          {(summary.data?.unread ?? 0) > 0 ? <Button variant="secondary" icon="checkmark-done" label={t('notifications.markAllRead')} onPress={() => markRead.mutate({ all: true })} busy={markRead.isPending} /> : null}
          {list.isError ? (
            <Text style={{ fontSize: 17, color: colors.danger }}>{t('notifications.loadError')}</Text>
          ) : list.isLoading ? (
            <Text style={{ fontSize: 17, color: colors.muted }}>{t('common.loading')}</Text>
          ) : (
            <NotificationList items={items} />
          )}
          {list.hasNextPage ? <Button variant="secondary" label={t('notifications.loadMore')} onPress={() => void list.fetchNextPage()} busy={list.isFetchingNextPage} /> : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  body: { padding: 20, gap: 14 },
  section: { fontSize: 22, fontWeight: '800' },
});
