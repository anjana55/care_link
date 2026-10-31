import { useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import type { SearchRequest } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button } from '@/ui/controls';
import { Text } from '@/ui/Text';
import { useCaregiverSearch, useSearchConfig } from '@/search/api';
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
 * the matches list below, a page at a time. Tapping one opens their profile.
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

  const results = useCaregiverSearch(request, mode === 'ai' ? aiQuery : null, locale);
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
          onSearch={(r, q) => {
            setAiQuery(q);
            setRequest(r);
            rememberSearch(r);
          }}
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
          onSearch={(r) => {
            setRequest(r);
            rememberSearch(r);
          }}
        />
      )}

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
