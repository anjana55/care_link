import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import type { NotificationCategory, TodoKind } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { useClient } from '@/care/api';
import { useMyBookings } from '@/care/bookings-api';
import { hasCareToday, nextVisit } from '@/care/next-visit';
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

/** Cards whose number is unread notices of a kind instead: new replies from the office. */
const UNREAD: Partial<Record<TileKey, NotificationCategory>> = { requests: 'REQUEST' };

/** The card that leads to the same place as a to-do: left out while that to-do is the one on top, so it isn't shown twice. */
const CARD_FOR: Partial<Record<TodoKind, TileKey>> = { TICK_OFF_CARE: 'care' };

/**
 * What the brand band shows - one thing, the most useful first: the next
 * thing to do, else the next caregiver visit, else the search box. `waiting`
 * holds the band's place until we know, so it doesn't flash the search box
 * and then jump to a to-do.
 */
type Band = 'waiting' | 'todo' | 'visit' | 'search';

/**
 * A client's home - what Home opens. On the brand band: a greeting and the
 * bell, then one thing: the next thing to do with a big button for it,
 * else their next caregiver visit, else the search box. Under it a
 * full-width card with a picture for each thing they can do - a number on
 * the picture when something is waiting there. The card for whatever the
 * band shows is left out, so nothing appears twice (search is also the Find
 * tab), and "Today's care" shows only on a day with care. Home is where they already
 * are, so there is no Back or Home button here; every other screen keeps both.
 * Open to anyone: the screens behind the cards ask a signed-out person to
 * sign in where they need to.
 */
export default function Start() {
  const { t } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const client = useClient();
  const bookings = useMyBookings();
  const summary = useNotificationsSummary();
  const next = client && bookings.data ? nextVisit(bookings.data) : null;
  const todos = client ? (summary.data?.todos ?? []) : [];
  // A failed load counts as known (nothing to show) so the band never waits forever.
  const band: Band = !client
    ? 'search'
    : summary.isPending
      ? 'waiting'
      : todos.length
        ? 'todo'
        : bookings.isPending
          ? 'waiting'
          : next
            ? 'visit'
            : 'search';
  // Whatever the band shows is left out of the cards, so nothing is there twice.
  const onTop: TileKey | undefined = band === 'todo' ? CARD_FOR[todos[0].kind] : band === 'search' ? 'find' : undefined;
  // "Today's care" only on a day with care, or while there is care to tick off.
  const careToday = Boolean(client && (todos.some((i) => i.kind === 'TICK_OFF_CARE') || (bookings.data && hasCareToday(bookings.data))));
  const tiles = TILES.filter((tile) => tile.key !== onTop && (tile.key !== 'care' || careToday));
  const firstName = client ? summary.data?.firstName : null;
  const countFor = (key: TileKey) => {
    const kind = COUNTS[key];
    const category = UNREAD[key];
    if (kind) return todos.filter((i) => i.kind === kind).length;
    return client && category ? (summary.data?.unreadBy?.[category] ?? 0) : 0;
  };

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <HeroBand style={{ paddingTop: insets.top + 16, paddingBottom: 22, gap: 18 }}>
          <View style={styles.top}>
            <View style={{ flex: 1, gap: 2 }}>
              {/* Their own name once the server sends it; the brand's until then, and for someone not signed in. */}
              <Text style={styles.hello}>{client ? t('home.welcome') : t('clientHome.welcome')}</Text>
              <Text accessibilityRole="header" style={styles.title}>
                {firstName || t('app.name')}
              </Text>
            </View>
            <Bell />
          </View>
          {band === 'todo' ? <NextForYou items={todos} /> : null}
          {band === 'visit' && next ? <NextVisit next={next} onPress={() => router.navigate('/bookings')} /> : null}
          {band === 'search' ? (
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
          ) : null}
          {band === 'waiting' ? (
            <View
              testID="band-waiting"
              style={[styles.search, { backgroundColor: tint('#FFFFFF', 0.18) }]}
              accessibilityElementsHidden
              importantForAccessibility="no-hide-descendants"
            />
          ) : null}
        </HeroBand>
        <View style={styles.body}>
          <Text accessibilityRole="header" style={[styles.section, { color: colors.deep }]}>
            {t('clientHome.whatToDo')}
          </Text>
          <View style={{ gap: 14 }}>
            {tiles.map((tile) => {
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

        </View>
      </ScrollView>
    </View>
  );
}

/** The next caregiver visit, on the band when nothing is waiting to be done. */
function NextVisit({ next, onPress }: { next: NonNullable<ReturnType<typeof nextVisit>>; onPress: () => void }) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  return (
    <Pressable accessibilityRole="button" onPress={onPress} style={[styles.next, { backgroundColor: colors.deep }]}>
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
  next: { borderRadius: 20, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14 },
  nextIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  nextLabel: { fontSize: 15, fontWeight: '600', color: '#D7E9EE' },
  nextWho: { fontSize: 19, fontWeight: '800', color: '#FFFFFF' },
  nextWhen: { fontSize: 16, color: '#FFFFFF' },
});
