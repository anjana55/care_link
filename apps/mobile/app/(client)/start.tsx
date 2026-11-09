import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { TodoKind } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { useClient } from '@/care/api';
import { useMyBookings } from '@/care/bookings-api';
import { nextVisit } from '@/care/next-visit';
import { shortId } from '@/search/ResultCard';
import { fmtDay, fmtTime } from '@/ui/dates';
import { Bell, badgeLabel } from '@/notifications/Bell';
import { NextForYou } from '@/notifications/NextForYou';
import { useNotificationsSummary } from '@/notifications/api';
import { HomeArt, type HomeArtName } from '@/ui/HomeArt';
import { Text } from '@/ui/Text';
import { HeroBand, tint } from '@/ui/visual';

type Route = '/find' | '/bookings' | '/invoices' | '/saved' | '/requests';
type TileKey = HomeArtName;

/** The cards, in the order people most often need them. Today's care is at the top of Bookings. */
const TILES: { key: TileKey; label: string; to: Route }[] = [
  { key: 'find', label: 'welcome.findCare', to: '/find' },
  { key: 'bookings', label: 'account.nav.bookings', to: '/bookings' },
  { key: 'care', label: 'carePlan.todayTitle', to: '/bookings' },
  { key: 'bills', label: 'account.nav.invoices', to: '/invoices' },
  { key: 'saved', label: 'account.nav.saved', to: '/saved' },
  { key: 'requests', label: 'account.nav.requests', to: '/requests' },
];

/** Which to-dos a card's number counts: what is waiting behind that card. */
const COUNTS: Partial<Record<TileKey, TodoKind>> = { bookings: 'RATE_CAREGIVER', care: 'TICK_OFF_CARE', bills: 'PAY_INVOICE' };

/** The card that leads to the same place as a to-do: left out while that to-do is the one on top, so it isn't shown twice. */
const CARD_FOR: Partial<Record<TodoKind, TileKey>> = { TICK_OFF_CARE: 'care' };

/**
 * A client's home - what Home opens. On the brand band: a greeting and the
 * bell, then the one thing to do next with a big button for it (or, with
 * nothing to do, the search box). Under it a full-width card with a picture
 * for each thing they can do - a number on the picture when something is
 * waiting there - and their next caregiver visit. Home is where they already
 * are, so there is no Back or Home button here; every other screen keeps both.
 * Open to anyone: the screens behind the cards ask a signed-out person to
 * sign in where they need to.
 */
export default function Start() {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const client = useClient();
  const bookings = useMyBookings();
  const summary = useNotificationsSummary();
  const next = client && bookings.data ? nextVisit(bookings.data) : null;
  const todos = client ? (summary.data?.todos ?? []) : [];
  const onTop = todos[0] ? CARD_FOR[todos[0].kind] : undefined;
  const countFor = (key: TileKey) => {
    const kind = COUNTS[key];
    return kind ? todos.filter((i) => i.kind === kind).length : 0;
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <HeroBand style={{ paddingTop: insets.top + 16, paddingBottom: 22, gap: 18 }}>
          <View style={styles.top}>
            <View style={{ flex: 1, gap: 2 }}>
              <Text style={styles.hello}>{client ? t('home.welcome') : t('clientHome.welcome')}</Text>
              <Text accessibilityRole="header" style={styles.title}>
                {t('app.name')}
              </Text>
            </View>
            <Bell />
          </View>
          {todos.length ? (
            <NextForYou items={todos} />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={t('clientHome.search')}
              onPress={() => router.navigate('/find')}
              style={[styles.search, { backgroundColor: colors.surface }]}
            >
              <Text style={[styles.searchText, { color: colors.muted }]}>{t('clientHome.search')}</Text>
              <View style={[styles.searchIcon, { backgroundColor: colors.deep }]}>
                <Ionicons name="search" size={24} color={colors.brandText} />
              </View>
            </Pressable>
          )}
        </HeroBand>
        <View style={styles.body}>
          <Text accessibilityRole="header" style={[styles.section, { color: colors.deep }]}>
            {t('clientHome.whatToDo')}
          </Text>
          <View style={{ gap: 14 }}>
            {TILES.filter((tile) => tile.key !== onTop).map((tile) => {
              const count = countFor(tile.key);
              const label = t(tile.label);
              const hint = t(`clientHome.hints.${tile.key}`);
              return (
                <Pressable
                  key={tile.key}
                  accessibilityRole="button"
                  accessibilityLabel={label}
                  accessibilityHint={count ? `${hint}. ${t('clientHome.waiting', { count })}` : hint}
                  onPress={() => router.navigate(tile.to)}
                  style={({ pressed }) => [styles.card, { backgroundColor: pressed ? tint(colors.brand, 0.06) : colors.surface, borderColor: colors.border }]}
                >
                  <View style={{ flex: 1, gap: 4 }}>
                    <Text style={[styles.cardLabel, { color: colors.deep }]}>{label}</Text>
                    <Text style={[styles.cardHint, { color: colors.muted }]}>{hint}</Text>
                  </View>
                  <View style={[styles.art, { backgroundColor: tint(colors.brand, 0.14) }]}>
                    <HomeArt name={tile.key} width={92} />
                    {count > 0 ? (
                      <View testID={`count-${tile.key}`} style={[styles.count, { backgroundColor: colors.deep }]} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
                        <Text style={styles.countText}>{badgeLabel(count)}</Text>
                      </View>
                    ) : null}
                  </View>
                </Pressable>
              );
            })}
          </View>

          {next ? (
            <Pressable
              accessibilityRole="button"
              onPress={() => router.navigate('/bookings')}
              style={[styles.next, { backgroundColor: colors.deep }]}
            >
              <View style={[styles.nextIcon, { backgroundColor: colors.surface }]}>
                <Ionicons name="person" size={28} color={colors.deep} />
              </View>
              <View style={{ flex: 1, gap: 2 }}>
                <Text style={styles.nextLabel}>{t('clientHome.nextVisit')}</Text>
                <Text style={styles.nextWho}>
                  {next.booking.caregiver ? t('profile.anonymousId', { id: shortId(next.booking.caregiver.publicId) }) : next.booking.reference}
                </Text>
                <Text style={styles.nextWhen}>
                  {t('clientHome.nextVisitWhen', { day: fmtDay(next.shift.startsAt, locale), from: fmtTime(next.shift.startsAt), to: fmtTime(next.shift.endsAt) })}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={28} color={colors.brandText} />
            </Pressable>
          ) : null}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  hello: { fontSize: 18, color: '#FFFFFF' },
  title: { fontSize: 30, lineHeight: 38, fontWeight: '800', color: '#FFFFFF' },
  search: { minHeight: 62, borderRadius: 18, flexDirection: 'row', alignItems: 'center', paddingLeft: 18, paddingRight: 7, gap: 8 },
  searchText: { flex: 1, fontSize: 18 },
  searchIcon: { width: 48, height: 48, borderRadius: 24, alignItems: 'center', justifyContent: 'center' },
  top: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  body: { padding: 20, gap: 14 },
  section: { fontSize: 22, fontWeight: '800', marginTop: 4 },
  card: { minHeight: 108, borderRadius: 20, borderWidth: 2, paddingVertical: 12, paddingLeft: 20, paddingRight: 12, flexDirection: 'row', alignItems: 'center', gap: 12 },
  cardLabel: { fontSize: 21, lineHeight: 27, fontWeight: '800' },
  cardHint: { fontSize: 16, lineHeight: 22 },
  art: { width: 108, height: 84, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  count: { position: 'absolute', top: -8, right: -8, minWidth: 32, height: 32, borderRadius: 16, paddingHorizontal: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 3, borderColor: '#FFFFFF' },
  countText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800', lineHeight: 20 },
  next: { borderRadius: 20, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4 },
  nextIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  nextLabel: { fontSize: 15, fontWeight: '600', color: '#D7E9EE' },
  nextWho: { fontSize: 19, fontWeight: '800', color: '#FFFFFF' },
  nextWhen: { fontSize: 16, color: '#FFFFFF' },
});
