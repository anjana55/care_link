import { Pressable, StyleSheet, View, type StyleProp, type ViewStyle } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import type { TodoItem } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { screenFor } from '@/push/notifications';
import { formatDate } from '@/ui/dates';
import { Text } from '@/ui/Text';
import { tint } from '@/ui/visual';
import { TODO_ICONS, useTodoText } from './Lists';

/**
 * The one thing to do next - on the client home's brand band, and at the top
 * of a caregiver's Today (which passes `style` to stand on the page rather
 * than the band): what it is, one big button for it, and - when there is more - a link to the whole To do
 * list behind the bell. The first to-do is the most pressing (the API puts
 * urgent ones first), so the person never has to work out where to start.
 * Urgent items take the To do list's warning colours.
 */
export function NextForYou({ items, style }: { items: TodoItem[]; style?: StyleProp<ViewStyle> }) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const text = useTodoText();
  const item = items[0];
  if (!item) return null;
  const tone = item.urgent ? '#B45309' : colors.brand;
  const action = t(`notifications.action.${item.kind}`);
  return (
    <View accessibilityLabel={t('clientHome.nextForYou')} style={[styles.card, { backgroundColor: item.urgent ? '#FFF7E6' : colors.surface }, style]}>
      <View style={styles.row}>
        <View style={[styles.icon, { backgroundColor: tint(tone, 0.14) }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Ionicons name={TODO_ICONS[item.kind] ?? 'alert-circle-outline'} size={30} color={tone} />
        </View>
        <View style={{ flex: 1, gap: 2 }}>
          <Text accessibilityRole="header" style={[styles.kicker, { color: tone }]}>
            {t('clientHome.nextForYou')}
            {items.length > 1 ? ` · ${t('clientHome.nextOf', { n: 1, total: items.length })}` : ''}
          </Text>
          <Text style={[styles.what, { color: colors.ink }]}>{text(item)}</Text>
          {item.dueOn && item.kind === 'PAY_INVOICE' ? (
            <Text style={{ fontSize: 15, color: colors.muted }}>{t('notifications.due', { date: formatDate(item.dueOn, locale) })}</Text>
          ) : null}
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${action}: ${text(item)}`}
        onPress={() => router.push(screenFor(item.path) as never)}
        style={({ pressed }) => [styles.action, { backgroundColor: colors.deep, opacity: pressed ? 0.85 : 1 }]}
      >
        <Text style={[styles.actionText, { color: colors.brandText }]}>{action}</Text>
      </Pressable>
      {items.length > 1 ? (
        <Pressable accessibilityRole="link" onPress={() => router.push('/notifications')} hitSlop={6} style={styles.more}>
          <Text style={[styles.moreText, { color: colors.brand }]}>{t('clientHome.seeAll', { count: items.length })}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: { borderRadius: 20, padding: 16, gap: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  icon: { width: 56, height: 56, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  kicker: { fontSize: 15, fontWeight: '800', letterSpacing: 0.4 },
  what: { fontSize: 20, lineHeight: 26, fontWeight: '800' },
  action: { minHeight: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 20 },
  actionText: { fontSize: 19, fontWeight: '800' },
  more: { minHeight: 44, alignItems: 'center', justifyContent: 'center' },
  moreText: { fontSize: 17, fontWeight: '700' },
});
