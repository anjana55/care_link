import { Tabs } from 'expo-router/js-tabs';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { fontFamilyFor } from '@/ui/fonts';
import { HIDDEN_TAB } from '@/ui/tabs';
import { useTabBadge, useWaitingCounts } from '@/notifications/tab-counts';

/**
 * The client side of the app: Home (big tiles for everything), Find (for
 * anyone, signed in or not), Bookings and My account. My requests, Saved
 * caregivers and Invoices open from Home's tiles and My account. The others
 * ask a client to sign in.
 *
 * A tab carries a number when something is waiting behind it, so it shows
 * from any screen: care to tick off and caregivers to rate on Bookings;
 * invoices to pay and new replies from the office on My account, where
 * Invoices and My requests open from.
 */
export default function ClientLayout() {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const waiting = useWaitingCounts();
  const badge = useTabBadge();
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
      <Tabs.Screen
        name="start"
        options={{
          tabBarLabel: t('nav.home'),
          tabBarIcon: ({ color, size }) => <Ionicons name="home-outline" color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen
        name="find"
        options={{
          tabBarLabel: t('nav.find'),
          tabBarAccessibilityLabel: t('account.findCaregivers'),
          tabBarIcon: ({ color, size }) => <Ionicons name="search" color={color as string} size={size} />,
        }}
      />
      <Tabs.Screen
        name="bookings"
        options={{
          tabBarLabel: t('account.nav.bookings'),
          ...badge(t('account.nav.bookings'), waiting.todos('TICK_OFF_CARE', 'RATE_CAREGIVER')),
          tabBarIcon: ({ color, size }) => <Ionicons name="calendar-outline" color={color as string} size={size} />,
        }}
      />
      {/* Reached from Home's tiles and My account, with the tab bar still showing: four tabs stay readable on a phone. */}
      <Tabs.Screen name="requests" options={HIDDEN_TAB} />
      <Tabs.Screen name="saved" options={HIDDEN_TAB} />
      <Tabs.Screen name="invoices" options={HIDDEN_TAB} />
      <Tabs.Screen
        name="account"
        options={{
          tabBarLabel: t('nav.myAccount'),
          ...badge(t('nav.myAccount'), waiting.todos('PAY_INVOICE') + waiting.unread('REQUEST')),
          tabBarIcon: ({ color, size }) => <Ionicons name="person-circle-outline" color={color as string} size={size} />,
        }}
      />
    </Tabs>
  );
}
