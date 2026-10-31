import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { DEFAULT_SEARCH_RADIUS_KM, withDeviceOrigin, withProfileOrigin, type DeviceLocation, type SearchRequest } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button } from '@/ui/controls';
import { Text } from '@/ui/Text';
import { useCaregiverSearch, useClientSearchOrigin, useCoverage, useSearchConfig } from '@/search/api';
import { useDeviceLocation } from '@/search/location';
import { Nearby } from '@/search/Nearby';
import { AiSearchPanel } from '@/search/AiSearchPanel';
import { NormalSearchForm } from '@/search/NormalSearchForm';
import { ResultCard } from '@/search/ResultCard';
import { rememberSearch } from '@/care/last-search';
import { RequestSheet } from '@/care/RequestSheet';
import { useClient } from '@/care/api';

type Mode = 'ai' | 'normal';

/**
 * Find a caregiver - for anyone, signed in or not. AI Search (a short
 * conversation) when it's switched on, Normal Search otherwise or on request;
 * the matches list below, a page at a time, and the map of caregivers near the
 * search location ("Use my location" measures from the phone). Tapping a match
 * opens their profile.
 */
export default function Find() {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const { data: config } = useSearchConfig();
  const aiEnabled = Boolean(config?.aiSearchEnabled);
  const [chosenMode, setChosenMode] = useState<Mode | null>(null);
  const mode: Mode = aiEnabled ? (chosenMode ?? 'ai') : 'normal';
  const [request, setRequest] = useState<SearchRequest | null>(null);
  const [aiQuery, setAiQuery] = useState<string | null>(null);
  // Bumped to clear the AI conversation when switching modes.
  const [panelKey, setPanelKey] = useState(0);
  const client = useClient();
  const [findForMe, setFindForMe] = useState(false);
  /** "Ask us to find a caregiver": the request sheet for a client, sign-in first for anyone else. */
  const askUs = () =>
    client ? setFindForMe(true) : router.push({ pathname: '/sign-in', params: { role: 'client', returnTo: '/requests' } });

  // "Use my location" before searching: the next search starts from there.
  const [here, setHere] = useState<DeviceLocation | null>(null);
  const [radiusKm, setRadiusKm] = useState<number>(DEFAULT_SEARCH_RADIUS_KM);
  const device = useDeviceLocation(locale);
  const { data: coverage = [] } = useCoverage(locale);
  // A signed-in client's profile city is where distances fall back to, as on the website.
  const { data: profileOrigin } = useClientSearchOrigin(client?.userId ?? null);
  const effective = request ? withProfileOrigin(request, profileOrigin?.cityId) : null;

  /** Every search goes through here: the person's location, if they gave it, comes along. */
  const search = (next: SearchRequest, query: string | null = null) => {
    const withHere = withDeviceOrigin(next, here, radiusKm);
    setAiQuery(query);
    setRequest(withHere);
    rememberSearch(withHere);
  };

  /** Same search, a different reach - or, before searching, how far the next one looks. */
  const changeRadius = (km: number) => {
    setRadiusKm(km);
    if (request) search({ ...request, radiusKm: km }, aiQuery);
  };

  /** With results showing, searches again around where the person is; before that, the next search starts there. */
  const locateMe = async () => {
    const found = await device.locate();
    if (!found) return;
    setHere(found);
    if (request) {
      const next = { ...request, location: { districtId: found.city.districtId, cityId: found.city.cityId }, origin: { latitude: found.latitude, longitude: found.longitude } };
      setRequest(next);
      rememberSearch(next);
    }
  };

  const results = useCaregiverSearch(effective, mode === 'ai' ? aiQuery : null, locale);
  const items = results.data?.pages.flatMap((p) => p.items) ?? [];
  const total = results.data?.pages[0]?.total;
  const aiRanked = Boolean(results.data?.pages[0] && 'aiRanked' in results.data.pages[0] && results.data.pages[0].aiRanked);

  const switchMode = (next: Mode) => {
    setChosenMode(next);
    setRequest(null);
    setAiQuery(null);
    setPanelKey((k) => k + 1);
  };

  const header = (
    <View style={styles.header}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
        {t('welcome.tagline')}
      </Text>

      {aiEnabled ? (
        <View accessibilityRole="tablist" style={[styles.modes, { borderColor: colors.border }]}>
          {(['ai', 'normal'] as const).map((m) => {
            const on = mode === m;
            return (
              <Pressable
                key={m}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                onPress={() => switchMode(m)}
                style={[styles.mode, on && { backgroundColor: colors.brand }]}
              >
                <Text style={{ fontSize: 15, fontWeight: '600', color: on ? colors.brandText : colors.ink }}>{t(`searchMode.${m}`)}</Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}

      {mode === 'ai' ? (
        <AiSearchPanel
          key={panelKey}
          onSearch={(r, q) => search(r, q)}
          onUseNormalSearch={() => switchMode('normal')}
          onReset={() => {
            setRequest(null);
            setAiQuery(null);
          }}
        />
      ) : (
        <NormalSearchForm
          key={panelKey}
          initial={request}
          onSearch={(r) => search(r)}
        />
      )}

      <Nearby
        response={results.data?.pages[0] ?? null}
        coverage={coverage}
        radiusKm={radiusKm}
        onRadiusChange={changeRadius}
        onUseMyLocation={() => void locateMe()}
        locating={device.locating}
        usingDevicePlace={here?.city.name ?? null}
        locationError={device.error}
      />

      {request ? (
        <View style={styles.resultsHead} accessibilityLiveRegion="polite">
          <Text accessibilityRole="header" style={[styles.resultsTitle, { color: colors.ink }]}>
            {t('results.title')}
            {typeof total === 'number' ? ` (${total})` : ''}
          </Text>
          {aiRanked ? <Text style={{ color: colors.muted, fontSize: 14, lineHeight: 20 }}>{t('results.aiRankedNote')}</Text> : null}
        </View>
      ) : null}
    </View>
  );

  const footer = !request ? null : results.isLoading ? (
    <View accessibilityRole="progressbar" style={styles.state}>
      <ActivityIndicator color={colors.brand} />
      <Text style={{ color: colors.muted }}>{t('loading.searching')}</Text>
    </View>
  ) : results.isError ? (
    <View accessibilityRole="alert" style={styles.state}>
      <Text style={[styles.stateTitle, { color: colors.ink }]}>{t('error.title')}</Text>
      <Text style={{ color: colors.muted, textAlign: 'center' }}>{t('error.subtitle')}</Text>
      <Button variant="secondary" label={t('error.retry')} onPress={() => results.refetch()} />
    </View>
  ) : !items.length ? (
    <View style={styles.state}>
      <Text style={[styles.stateTitle, { color: colors.ink }]}>{t('empty.title')}</Text>
      <Text style={{ color: colors.muted, textAlign: 'center' }}>{t('empty.subtitle')}</Text>
      <View style={[styles.askUs, { borderColor: colors.border, backgroundColor: colors.surface }]}>
        <Text style={[styles.stateTitle, { color: colors.ink }]}>{t('care.findForMe.title')}</Text>
        <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 22 }}>{t('care.findForMe.body')}</Text>
        <Button label={t('care.findForMe.cta')} onPress={askUs} />
      </View>
    </View>
  ) : results.hasNextPage ? (
    <View style={styles.more}>
      <Button variant="secondary" label={t('results.next')} busy={results.isFetchingNextPage} onPress={() => results.fetchNextPage()} />
    </View>
  ) : null;

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={request ? items : []}
        keyExtractor={(c) => c.publicId}
        ListHeaderComponent={header}
        ListFooterComponent={footer ?? undefined}
        keyboardShouldPersistTaps="handled"
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item }) => (
          <ResultCard caregiver={item} onOpen={() => router.push({ pathname: '/caregivers/[publicId]', params: { publicId: item.publicId } })} />
        )}
      />
      <RequestSheet
        visible={findForMe}
        onClose={() => setFindForMe(false)}
        onViewRequests={() => {
          setFindForMe(false);
          router.navigate('/requests');
        }}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 20, paddingBottom: 32 },
  header: { gap: 20, paddingTop: 16, paddingBottom: 16 },
  title: { fontSize: 26, lineHeight: 36, fontWeight: '700' },
  modes: { flexDirection: 'row', borderWidth: 1, borderRadius: 12, padding: 4, gap: 4 },
  mode: { flex: 1, minHeight: 44, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  resultsHead: { gap: 6, marginTop: 8 },
  resultsTitle: { fontSize: 20, fontWeight: '700' },
  state: { alignItems: 'center', gap: 10, paddingVertical: 24 },
  stateTitle: { fontSize: 18, fontWeight: '700' },
  more: { marginTop: 16 },
  askUs: { alignSelf: 'stretch', borderWidth: 1, borderRadius: 14, padding: 16, gap: 10, marginTop: 12 },
});
