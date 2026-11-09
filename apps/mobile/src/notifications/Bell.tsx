import { Pressable, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Text } from '@/ui/Text';
import { useBellUser, useNotificationsSummary } from './api';

/** The number on the bell: 1-9, then 9+. */
export const badgeLabel = (n: number) => (n > 9 ? '9+' : String(n));

/**
 * The bell at the top of every screen, between Back and Home, for signed-in
 * clients and caregivers. Its number is unread notifications plus things
 * still to do; it opens Notifications.
 */
export function Bell() {
  const { t } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const user = useBellUser();
  const { data } = useNotificationsSummary();
  if (!user) return null;
  const count = data?.badge ?? 0;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={count ? t('notifications.bellCount', { count }) : t('notifications.bell')}
      onPress={() => router.push('/notifications')}
      hitSlop={6}
      style={({ pressed }) => [styles.bell, { backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 }]}
    >
      <Ionicons name={count ? 'notifications' : 'notifications-outline'} size={26} color={colors.deep} />
      {count > 0 ? (
        <View style={[styles.badge, { backgroundColor: colors.danger }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <Text style={styles.badgeText}>{badgeLabel(count)}</Text>
        </View>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  bell: { width: 50, height: 50, borderRadius: 25, alignItems: 'center', justifyContent: 'center' },
  badge: { position: 'absolute', top: -4, right: -4, minWidth: 24, height: 24, borderRadius: 12, paddingHorizontal: 5, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#FFFFFF' },
  badgeText: { color: '#FFFFFF', fontSize: 13, fontWeight: '800', lineHeight: 16 },
});
