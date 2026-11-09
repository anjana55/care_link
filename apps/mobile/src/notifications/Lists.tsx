import { Linking, Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import type { NotificationCategory, NotificationItem, TodoItem, TodoKind } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { screenFor } from '@/push/notifications';
import { config } from '@/config';
import { formatDate, fmtDay, fmtTime } from '@/ui/dates';
import { Text } from '@/ui/Text';
import { tint, type IconName } from '@/ui/visual';
import { useMarkRead } from './api';

export const TODO_ICONS: Record<TodoKind, IconName> = {
  PAY_INVOICE: 'receipt-outline',
  RATE_CAREGIVER: 'star-outline',
  TICK_OFF_CARE: 'checkbox-outline',
  UPLOAD_DOCUMENT: 'cloud-upload-outline',
  DOCUMENT_REJECTED: 'alert-circle-outline',
  DOCUMENT_EXPIRING: 'time-outline',
  SHIFT_TODAY: 'calendar-outline',
};

const CATEGORY_ICONS: Record<NotificationCategory, IconName> = {
  BOOKING: 'calendar-outline',
  REQUEST: 'chatbubbles-outline',
  INVOICE: 'receipt-outline',
  PAYOUT: 'wallet-outline',
  REVIEW: 'star-outline',
  CARE: 'checkbox-outline',
  DOCUMENT: 'document-text-outline',
  ANNOUNCEMENT: 'megaphone-outline',
  REMINDER: 'notifications-outline',
  OTHER: 'notifications-outline',
};

/** The sentence for one to-do, in the app's language. */
export function useTodoText() {
  const { t } = useTranslation();
  return (item: TodoItem): string => {
    const p = item.params;
    const document = p.document ? t(`notifications.document.${p.document}`) : '';
    switch (item.kind) {
      case 'PAY_INVOICE':
        return t(p.overdue ? 'notifications.text.PAY_INVOICE_OVERDUE' : 'notifications.text.PAY_INVOICE', { number: String(p.number ?? ''), amount: String(p.amount ?? '') });
      case 'RATE_CAREGIVER':
        return t('notifications.text.RATE_CAREGIVER', { reference: String(p.reference ?? '') });
      case 'TICK_OFF_CARE':
        return t('notifications.text.TICK_OFF_CARE', { count: Number(p.count ?? 0) });
      case 'DOCUMENT_EXPIRING': {
        const days = Number(p.daysLeft ?? 0);
        if (days < 0) return t('notifications.text.DOCUMENT_EXPIRED', { document });
        if (days === 0) return t('notifications.text.DOCUMENT_EXPIRING_TODAY', { document });
        return t('notifications.text.DOCUMENT_EXPIRING', { document, days });
      }
      case 'SHIFT_TODAY':
        return t('notifications.text.SHIFT_TODAY', { time: String(p.time ?? ''), reference: String(p.reference ?? '') });
      default:
        return t(`notifications.text.${item.kind}`, { document });
    }
  };
}

/** Things still waiting on the person: a big card each, with one big button. Urgent ones first, in a warning colour. */
export function TodoList({ items, onOpen }: { items: TodoItem[]; onOpen?: () => void }) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const text = useTodoText();
  if (!items.length) return <Text style={{ fontSize: 17, color: colors.muted }}>{t('notifications.todoEmpty')}</Text>;
  return (
    <View style={{ gap: 12 }}>
      {items.map((item) => {
        const warn = item.urgent;
        const tone = warn ? '#B45309' : colors.brand;
        return (
          <View key={item.key} style={[styles.todo, { backgroundColor: warn ? '#FFF7E6' : colors.surface, borderColor: warn ? '#F5C26B' : colors.border }]}>
            <View style={styles.todoRow}>
              <View style={[styles.icon, { backgroundColor: tint(tone, 0.14) }]}>
                <Ionicons name={TODO_ICONS[item.kind] ?? 'alert-circle-outline'} size={26} color={tone} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={[styles.todoText, { color: colors.ink }]}>{text(item)}</Text>
                {item.dueOn && item.kind === 'PAY_INVOICE' ? (
                  <Text style={{ fontSize: 15, color: colors.muted }}>{t('notifications.due', { date: formatDate(item.dueOn, locale) })}</Text>
                ) : null}
              </View>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${t(`notifications.action.${item.kind}`)}: ${text(item)}`}
              onPress={() => {
                onOpen?.();
                router.push(screenFor(item.path) as never);
              }}
              style={({ pressed }) => [styles.action, { backgroundColor: colors.deep, opacity: pressed ? 0.85 : 1 }]}
            >
              <Text style={[styles.actionText, { color: colors.brandText }]}>{t(`notifications.action.${item.kind}`)}</Text>
            </Pressable>
          </View>
        );
      })}
    </View>
  );
}

/** Unread important notices first, then newest first. */
export function pinImportant(items: NotificationItem[]): NotificationItem[] {
  const pinned = items.filter((i) => i.important && !i.readAt);
  return [...pinned, ...items.filter((i) => !(i.important && !i.readAt))];
}

/** The notifications history. Tapping one opens the screen it is about and marks it read. */
export function NotificationList({ items }: { items: NotificationItem[] }) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const markRead = useMarkRead();
  if (!items.length) return <Text style={{ fontSize: 17, color: colors.muted }}>{t('notifications.empty')}</Text>;
  return (
    <View style={[styles.list, { backgroundColor: colors.surface, borderColor: colors.border }]}>
      {pinImportant(items).map((item, i) => {
        const unread = !item.readAt;
        const goesSomewhere = item.path !== '/notifications';
        const open = () => {
          if (unread) markRead.mutate({ ids: [item.id] });
          if (goesSomewhere) router.push(screenFor(item.path) as never);
        };
        return (
          <View key={item.id} style={[i > 0 && { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.border }, unread && { backgroundColor: tint(colors.brand, 0.06) }]}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`${unread ? `${t('notifications.new')}. ` : ''}${item.title}. ${item.body}`}
              onPress={open}
              style={({ pressed }) => [styles.item, { opacity: pressed ? 0.8 : 1 }]}
            >
              <View style={[styles.icon, { backgroundColor: unread ? tint(colors.brand, 0.14) : tint(colors.muted, 0.1) }]}>
                <Ionicons name={CATEGORY_ICONS[item.category] ?? 'notifications-outline'} size={24} color={unread ? colors.brand : colors.muted} />
              </View>
              <View style={{ flex: 1, gap: 3 }}>
                <View style={styles.titleRow}>
                  <Text style={[styles.title, { color: colors.ink, fontWeight: unread ? '800' : '600' }]}>{item.title}</Text>
                  {item.important && unread ? (
                    <Text style={[styles.important, { backgroundColor: '#FDECC8', color: '#92400E' }]}>{t('notifications.important')}</Text>
                  ) : null}
                </View>
                <Text style={{ fontSize: 16, lineHeight: 23, color: colors.ink }}>{item.body}</Text>
                <Text style={{ fontSize: 14, color: colors.muted }}>
                  {fmtDay(item.createdAt, locale)} · {fmtTime(item.createdAt)}
                </Text>
              </View>
              {unread ? <View style={[styles.dot, { backgroundColor: colors.brand }]} /> : null}
            </Pressable>
            {item.link ? (
              <Pressable
                accessibilityRole="link"
                accessibilityLabel={t('notifications.openLink')}
                onPress={() => {
                  if (unread) markRead.mutate({ ids: [item.id] });
                  // A page on the website opens there (the app link may bring it back into the app); an outside https:// address in the browser.
                  const url = item.link!.startsWith('/') ? `${config.siteUrl}${item.link}` : item.link!;
                  if (url.startsWith('https://') || url.startsWith('http://')) Linking.openURL(url).catch(() => undefined);
                }}
                style={styles.link}
              >
                <Text style={{ fontSize: 17, fontWeight: '700', color: colors.brand }}>{t('notifications.openLink')}</Text>
              </Pressable>
            ) : null}
          </View>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  todo: { borderWidth: 1, borderRadius: 18, padding: 16, gap: 14 },
  todoRow: { flexDirection: 'row', gap: 12, alignItems: 'center' },
  todoText: { fontSize: 18, lineHeight: 25, fontWeight: '700' },
  icon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  action: { minHeight: 54, borderRadius: 27, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  actionText: { fontSize: 18, fontWeight: '800' },
  list: { borderWidth: 1, borderRadius: 18, overflow: 'hidden' },
  item: { flexDirection: 'row', gap: 12, padding: 16, alignItems: 'flex-start' },
  titleRow: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
  title: { fontSize: 17, lineHeight: 24 },
  important: { fontSize: 13, fontWeight: '800', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, overflow: 'hidden' },
  dot: { width: 12, height: 12, borderRadius: 6, marginTop: 8 },
  link: { minHeight: 48, justifyContent: 'center', paddingLeft: 76, paddingBottom: 8 },
});
