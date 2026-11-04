import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useRouter } from 'expo-router';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { useClient } from '@/care/api';
import { useMyBookings } from '@/care/bookings-api';
import { nextVisit } from '@/care/next-visit';
import { shortId } from '@/search/ResultCard';
import { fmtDay, fmtTime } from '@/ui/dates';
import { PageHeader } from '@/ui/PageHeader';
import { TodoCards } from '@/notifications/TodoCards';
import { Text } from '@/ui/Text';
import { tint, type IconName } from '@/ui/visual';

type Route = '/find' | '/bookings' | '/invoices' | '/saved' | '/requests';

/** The tiles, in the order people most often need them. Today's care is at the top of Bookings. */
const TILES: { key: string; label: string; icon: IconName; to: Route }[] = [
  { key: 'find', label: 'welcome.findCare', icon: 'search', to: '/find' },
  { key: 'bookings', label: 'account.nav.bookings', icon: 'calendar', to: '/bookings' },
  { key: 'care', label: 'carePlan.todayTitle', icon: 'checkbox', to: '/bookings' },
  { key: 'bills', label: 'account.nav.invoices', icon: 'receipt', to: '/invoices' },
  { key: 'saved', label: 'account.nav.saved', icon: 'heart', to: '/saved' },
  { key: 'requests', label: 'account.nav.requests', icon: 'chatbubbles', to: '/requests' },
];

/**
 * A client's home - what Home opens. A greeting, a big search button, then
 * one large tile for each thing they can do, and their next caregiver visit.
 * Open to anyone: the screens behind the tiles ask a signed-out person to
 * sign in where they need to.
 */
export default function Start() {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const client = useClient();
  const bookings = useMyBookings();
  const next = client && bookings.data ? nextVisit(bookings.data) : null;

  return (
    <View style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView contentContainerStyle={{ paddingBottom: 32 }}>
        <PageHeader isHome>
          <View style={{ gap: 2 }}>
            <Text style={styles.hello}>{client ? t('home.welcome') : t('clientHome.welcome')}</Text>
            <Text accessibilityRole="header" style={styles.title}>
              {t('app.name')}
            </Text>
          </View>
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
        </PageHeader>
        <View style={styles.body}>
          {/* What is waiting on them comes first. */}
          <TodoCards />
          <Text accessibilityRole="header" style={[styles.section, { color: colors.deep }]}>
            {t('clientHome.whatToDo')}
          </Text>
          <View style={styles.tiles}>
            {TILES.map((tile) => (
              <Pressable
                key={tile.key}
                accessibilityRole="button"
                accessibilityLabel={t(tile.label)}
                onPress={() => router.navigate(tile.to)}
                style={({ pressed }) => [styles.tile, { backgroundColor: pressed ? tint(colors.brand, 0.06) : colors.surface, borderColor: colors.border }]}
              >
                <View style={[styles.tileIcon, { backgroundColor: tint(colors.brand, 0.12) }]}>
                  <Ionicons name={tile.icon} size={30} color={colors.brand} />
                </View>
                <Text style={[styles.tileLabel, { color: colors.deep }]}>{t(tile.label)}</Text>
              </Pressable>
            ))}
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
  body: { padding: 20, gap: 14 },
  section: { fontSize: 22, fontWeight: '800', marginTop: 4 },
  tiles: { flexDirection: 'row', flexWrap: 'wrap', gap: 14 },
  tile: { flexBasis: '45%', flexGrow: 1, minHeight: 140, borderRadius: 20, borderWidth: 2, padding: 16, justifyContent: 'space-between', gap: 12 },
  tileIcon: { width: 58, height: 58, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
  tileLabel: { fontSize: 19, lineHeight: 25, fontWeight: '700' },
  next: { borderRadius: 20, padding: 18, flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4 },
  nextIcon: { width: 56, height: 56, borderRadius: 28, alignItems: 'center', justifyContent: 'center' },
  nextLabel: { fontSize: 15, fontWeight: '600', color: '#D7E9EE' },
  nextWho: { fontSize: 19, fontWeight: '800', color: '#FFFFFF' },
  nextWhen: { fontSize: 16, color: '#FFFFFF' },
});
