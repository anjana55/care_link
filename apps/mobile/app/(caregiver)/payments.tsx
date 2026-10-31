import { useState } from 'react';
import { ActivityIndicator, Pressable, RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { formatLkr } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Text } from '@/ui/Text';
import { formatDate } from '@/ui/dates';
import { useMyPayouts } from '@/caregiver/api';

/**
 * The caregiver's payout statements, as on the website: what they're paid for
 * which shifts, and when it was sent. Read-only - staff prepare and pay them,
 * and only approved or paid statements are shown. Tap one for its lines.
 */
export default function Payments() {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const payouts = useMyPayouts();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <SafeAreaView edges={['top']} style={{ flex: 1, backgroundColor: colors.background }}>
      <ScrollView
        contentContainerStyle={styles.page}
        refreshControl={<RefreshControl refreshing={payouts.isRefetching} onRefresh={() => void payouts.refetch()} />}
      >
        <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
          {t('portal.payments.title')}
        </Text>
        <Text style={{ fontSize: 15, lineHeight: 22, color: colors.muted }}>{t('portal.payments.subtitle')}</Text>
        {payouts.isLoading ? <ActivityIndicator color={colors.brand} /> : null}
        {payouts.isError ? <Text style={{ color: colors.danger }}>{t('care.actionError')}</Text> : null}
        {payouts.isSuccess && !payouts.data.length ? <Text style={{ fontSize: 15, lineHeight: 22, color: colors.muted }}>{t('portal.payments.empty')}</Text> : null}

        {(payouts.data ?? []).map((p) => {
          const expanded = open === p.id;
          const paid = p.status === 'PAID';
          return (
            <View key={p.id} style={[styles.card, { borderColor: colors.border, backgroundColor: colors.surface }]}>
              <Pressable
                accessibilityRole="button"
                accessibilityState={{ expanded }}
                accessibilityLabel={`${formatDate(p.periodStart, locale)} – ${formatDate(p.periodEnd, locale)}, ${formatLkr(p.total)}, ${t(`portal.payments.status.${p.status}`)}`}
                onPress={() => setOpen(expanded ? null : p.id)}
                style={styles.head}
              >
                <View style={{ flex: 1, gap: 2 }}>
                  <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>
                    {formatDate(p.periodStart, locale)} – {formatDate(p.periodEnd, locale)}
                  </Text>
                  <Text style={{ fontSize: 13, color: colors.muted }}>
                    {p.reference}
                    {paid && p.paidOn ? ` · ${t('portal.payments.paidOn', { date: formatDate(p.paidOn, locale) })}` : ''}
                  </Text>
                </View>
                <View style={{ alignItems: 'flex-end', gap: 4 }}>
                  <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>{formatLkr(p.total)}</Text>
                  <Text style={[styles.badge, { color: paid ? colors.brand : colors.ink, borderColor: paid ? colors.brand : colors.border }]}>
                    {t(`portal.payments.status.${p.status}`)}
                  </Text>
                </View>
              </Pressable>
              {expanded ? (
                <View style={[styles.lines, { borderColor: colors.border }]}>
                  {p.lines.map((l, i) => (
                    <View key={i} style={styles.line}>
                      <Text style={{ flex: 1, fontSize: 14, color: colors.ink }}>
                        {l.serviceDate ? <Text style={{ color: colors.muted }}>{formatDate(l.serviceDate, locale)}  </Text> : null}
                        {l.description}
                      </Text>
                      <Text style={{ fontSize: 14, color: Number(l.amount) < 0 ? colors.danger : colors.ink }}>{formatLkr(l.amount)}</Text>
                    </View>
                  ))}
                  {paid && p.paymentReference ? <Text style={{ fontSize: 13, color: colors.muted }}>{t('portal.payments.reference', { reference: p.paymentReference })}</Text> : null}
                  {p.status === 'APPROVED' ? <Text style={{ fontSize: 13, color: colors.muted }}>{t('portal.payments.approvedHint')}</Text> : null}
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  page: { padding: 20, gap: 12, paddingBottom: 40 },
  title: { fontSize: 26, fontWeight: '700' },
  card: { borderWidth: 1, borderRadius: 14, overflow: 'hidden' },
  head: { flexDirection: 'row', gap: 12, padding: 16, alignItems: 'center' },
  badge: { fontSize: 12, fontWeight: '700', borderWidth: 1, borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  lines: { borderTopWidth: StyleSheet.hairlineWidth, padding: 16, gap: 6 },
  line: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
});
