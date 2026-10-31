import { Tabs } from 'expo-router/js-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { fontFamilyFor } from '@/ui/fonts';
import { HIDDEN_TAB } from '@/ui/tabs';

/**
 * The client side of the app: Find (for anyone, signed in or not), Bookings,
 * My requests and My account, which also opens Saved caregivers and Invoices.
 * The others ask a client to sign in.
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
        name="bookings"
        options={{
          tabBarLabel: t('account.nav.bookings'),
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen
        name="requests"
        options={{
          tabBarLabel: t('account.nav.requests'),
          tabBarIcon: ({ color, size }) => <Ionicons name="chatbubbles-outline" color={color as string} size={size} />,
        }}
      />
      {/* Reached from My account, with the tab bar still showing: four tabs stay readable on a phone. */}
      <Tabs.Screen name="saved" options={HIDDEN_TAB} />
      <Tabs.Screen name="invoices" options={HIDDEN_TAB} />
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
