import { Tabs } from 'expo-router/js-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { fontFamilyFor } from '@/ui/fonts';
import { HIDDEN_TAB } from '@/ui/tabs';
import { useTabBadge, useWaitingCounts } from '@/notifications/tab-counts';

/**
 * The caregiver side of the app: Today (status, the next shifts and today's
 * care plan), Shifts, Payments and Me. Documents opens from Me and from
 * Today's "documents needed"; Profile and Ratings open from Me.
 *
 * Me carries a number while documents are waiting on the caregiver (to
 * upload, rejected or about to expire), so it shows from any screen.
 */
export default function CaregiverLayout() {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const waiting = useWaitingCounts();
  const badge = useTabBadge();
  const documents = waiting.todos('UPLOAD_DOCUMENT', 'DOCUMENT_REJECTED', 'DOCUMENT_EXPIRING');
  const icon = (name: keyof typeof Ionicons.glyphMap) =>
    function TabIcon({ color, size }: { color: unknown; size: number }) {
      return <Ionicons name={name} color={color as string} size={size} />;
    };
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontFamily: fontFamilyFor(locale, false), fontSize: 14 },
      }}
    >
      <Tabs.Screen name="home" options={{ tabBarLabel: t('carePlan.today'), tabBarIcon: icon('today-outline') }} />
      <Tabs.Screen name="shifts" options={{ tabBarLabel: t('portal.nav.shifts'), tabBarIcon: icon('calendar-outline') }} />
      <Tabs.Screen name="payments" options={{ tabBarLabel: t('portal.nav.payments'), tabBarIcon: icon('wallet-outline') }} />
      <Tabs.Screen name="me" options={{ tabBarLabel: t('nav.myAccount'), tabBarIcon: icon('person-circle-outline'), ...badge(t('nav.myAccount'), documents) }} />
      <Tabs.Screen name="documents" options={HIDDEN_TAB} />
      <Tabs.Screen name="profile" options={HIDDEN_TAB} />
      <Tabs.Screen name="ratings" options={HIDDEN_TAB} />
    </Tabs>
  );
}
