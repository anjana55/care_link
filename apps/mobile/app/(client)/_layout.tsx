import { Tabs } from 'expo-router/js-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { fontFamilyFor } from '@/ui/fonts';

/**
 * The client side of the app. Find works for anyone, signed in or not; Saved
 * and Requests ask a client to sign in, and the Account tab does. Bookings and
 * invoices join these tabs as they're built (Phase 2c-2d).
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
        name="saved"
        options={{
          tabBarLabel: t('account.nav.saved'),
          tabBarIcon: ({ color, size }) => <Ionicons name="heart-outline" color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen
        name="requests"
        options={{
          tabBarLabel: t('account.nav.requests'),
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles-outline" color={color as string} size={size} />,
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
