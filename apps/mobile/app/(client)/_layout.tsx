import { Tabs } from 'expo-router/js-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { fontFamilyFor } from '@/ui/fonts';

/**
 * The client side of the app. Find works for anyone, signed in or not; the
 * Account tab signs people in. Bookings, saved caregivers and invoices join
 * these tabs as they're built (Phase 2b-2d).
 */
export default function ClientLayout() {
  const { t, locale } = useTranslation();
  const colors = useColors();
  return (
    <Tabs
      screenOptions={{
        headerShown: false,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.muted,
        tabBarStyle: { backgroundColor: colors.surface, borderTopColor: colors.border },
        tabBarLabelStyle: { fontFamily: fontFamilyFor(locale, false), fontSize: 12 },
      }}
    >
      <Tabs.Screen
        name="find"
        options={{
          tabBarLabel: t('account.findCaregivers'),
          tabBarIcon: ({ color, size }) => <Ionicons name="search" color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen
        name="account"
        options={{
          tabBarLabel: t('nav.myAccount'),
          tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" color={color as string} size={size} />,
        }}
      />
    </Tabs>
  );
}
