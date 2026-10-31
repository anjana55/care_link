import { ActivityIndicator, FlatList, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button } from '@/ui/controls';
import { Text } from '@/ui/Text';
import { formatDate } from '@/ui/dates';
import { useClient, useSavedCaregivers, useSetSaved } from '@/care/api';
import { SignInPrompt } from '@/care/SignInPrompt';
import { ResultCard } from '@/search/ResultCard';

/** The client's shortlist, as on the website's Saved caregivers page. */
export default function Saved() {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const client = useClient();
  const saved = useSavedCaregivers();
  const setSaved = useSetSaved();

  const head = (
    <View style={styles.head}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
        {t('account.saved.title')}
      </Text>
      <Text style={{ fontSize: 15, lineHeight: 22, color: colors.muted }}>{t('account.saved.subtitle')}</Text>
      {!client ? <SignInPrompt body={t('profile.saveCta')} /> : null}
    </View>
  );

  const empty = !client ? null : saved.isLoading ? (
    <ActivityIndicator color={colors.brand} />
  ) : saved.isError ? (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.danger }}>{t('care.actionError')}</Text>
      <Button variant="secondary" label={t('error.retry')} onPress={() => saved.refetch()} />
    </View>
  ) : (
    <View style={{ gap: 12 }}>
      <Text style={{ fontSize: 16, color: colors.muted }}>{t('account.saved.empty')}</Text>
      <Button variant="secondary" label={t('account.requests.emptyCta')} onPress={() => router.navigate('/find')} />
    </View>
  );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={client ? (saved.data ?? []) : []}
        keyExtractor={(s) => s.caregiverPublicId}
        ListHeaderComponent={head}
        ListEmptyComponent={empty ?? undefined}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        renderItem={({ item }) => (
          <View style={{ gap: 6 }}>
            {item.caregiver ? (
              <ResultCard
                caregiver={{ ...item.caregiver, reach: null }}
                onOpen={() => router.push({ pathname: '/caregivers/[publicId]', params: { publicId: item.caregiverPublicId } })}
              />
            ) : (
              <Text style={[styles.gone, { color: colors.muted, borderColor: colors.border }]}>{t('account.saved.unavailable')}</Text>
            )}
            <View style={styles.row}>
              <Text style={{ fontSize: 13, color: colors.muted }}>{t('account.saved.savedOn', { date: formatDate(item.savedAt, locale) })}</Text>
              <Button variant="link" label={t('account.saved.remove')} onPress={() => setSaved.mutate({ publicId: item.caregiverPublicId, saved: false })} />
            </View>
          </View>
        )}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 20, paddingBottom: 32 },
  head: { gap: 8, paddingTop: 16, paddingBottom: 16 },
  title: { fontSize: 26, fontWeight: '700' },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  gone: { borderWidth: 1, borderRadius: 14, padding: 16, fontSize: 15 },
});
