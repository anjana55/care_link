import { ActivityIndicator, FlatList, Pressable, RefreshControl, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useRouter } from 'expo-router';
import { formatLkr, type ClientInvoice } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button } from '@/ui/controls';
import { Text } from '@/ui/Text';
import { formatDate } from '@/ui/dates';
import { useClient } from '@/care/api';
import { useMyInvoices } from '@/care/billing-api';
import { SignInPrompt } from '@/care/SignInPrompt';

/** The client's invoices, as on the website: what's still to pay first, with the total owing. */
export default function Invoices() {
  const { t } = useTranslation();
  const colors = useColors();
  const client = useClient();
  const invoices = useMyInvoices();
  const sorted = [...(invoices.data ?? [])].sort((a, b) => Number(b.status === 'ISSUED') - Number(a.status === 'ISSUED'));
  const owing = (invoices.data ?? []).filter((i) => i.status === 'ISSUED').reduce((sum, i) => sum + Number(i.balance), 0);

  const head = (
    <View style={styles.head}>
      <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
        {t('invoices.title')}
      </Text>
      <Text style={{ fontSize: 15, lineHeight: 22, color: colors.muted }}>{t('invoices.subtitle')}</Text>
      {!client ? <SignInPrompt body={t('invoices.empty')} /> : null}
      {owing > 0 ? (
        <Text style={[styles.owing, { borderColor: colors.brand, color: colors.ink }]}>
          {t('invoices.owing')} <Text style={{ fontWeight: '700' }}>{formatLkr(owing.toFixed(2))}</Text>
        </Text>
      ) : null}
    </View>
  );

  const empty = !client ? null : invoices.isLoading ? (
    <ActivityIndicator color={colors.brand} />
  ) : invoices.isError ? (
    <View style={{ gap: 8 }}>
      <Text style={{ color: colors.danger }}>{t('care.actionError')}</Text>
      <Button variant="secondary" label={t('error.retry')} onPress={() => invoices.refetch()} />
    </View>
  ) : (
    <Text style={{ fontSize: 16, color: colors.muted }}>{t('invoices.empty')}</Text>
  );

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.background }}>
      <FlatList
        data={client ? sorted : []}
        keyExtractor={(i) => i.id}
        ListHeaderComponent={head}
        ListEmptyComponent={empty ?? undefined}
        contentContainerStyle={styles.list}
        ItemSeparatorComponent={() => <View style={{ height: 12 }} />}
        refreshControl={client ? <RefreshControl refreshing={invoices.isRefetching} onRefresh={() => void invoices.refetch()} /> : undefined}
        renderItem={({ item }) => <InvoiceRow invoice={item} />}
      />
    </SafeAreaView>
  );
}

function InvoiceRow({ invoice: inv }: { invoice: ClientInvoice }) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const toPay = inv.status === 'ISSUED';
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${inv.number}, ${t(`invoices.status.${inv.status}`)}`}
      onPress={() => router.push({ pathname: '/invoices/[id]', params: { id: inv.id } })}
      style={({ pressed }) => [styles.card, { borderColor: colors.border, backgroundColor: colors.surface, opacity: pressed ? 0.85 : 1 }]}
    >
      <View style={styles.row}>
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>{inv.number}</Text>
        <View style={styles.badges}>
          {inv.overdue ? <Text style={[styles.badge, { color: colors.danger, borderColor: colors.danger }]}>{t('invoices.overdue')}</Text> : null}
          <Text style={[styles.badge, { color: toPay ? colors.brand : colors.muted, borderColor: toPay ? colors.brand : colors.border }]}>
            {t(`invoices.status.${inv.status}`)}
          </Text>
        </View>
      </View>
      <Text style={{ fontSize: 14, color: colors.muted }}>
        {t('invoices.issuedOn', { date: formatDate(inv.issueDate, locale) })}
        {inv.bookingReference ? ` · ${inv.bookingReference}` : ''}
      </Text>
      <View style={styles.row}>
        <Text style={{ color: colors.muted }}>{toPay ? t('invoices.balance') : t('invoices.total')}</Text>
        <Text style={{ fontSize: 17, fontWeight: '700', color: colors.ink }}>{formatLkr(toPay ? inv.balance : inv.total)}</Text>
      </View>
      {toPay ? (
        <Text style={{ fontSize: 14, color: inv.overdue ? colors.danger : colors.muted }}>
          {t('invoices.due')}: {formatDate(inv.dueDate, locale)}
        </Text>
      ) : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: 20, paddingBottom: 32 },
  head: { gap: 10, paddingTop: 16, paddingBottom: 16 },
  title: { fontSize: 26, fontWeight: '700' },
  owing: { borderLeftWidth: 4, paddingLeft: 10, paddingVertical: 6, fontSize: 16 },
  card: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 6 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  badges: { flexDirection: 'row', gap: 6 },
  badge: { fontSize: 12, fontWeight: '700', borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
});
