import { StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { formatLkr, type PayableInvoice } from '@care-platform/shared';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button } from '@/ui/controls';
import { Text } from '@/ui/Text';
import { formatDate } from '@/ui/dates';

/**
 * "Pay now" for an invoice a booking is waiting for. It opens the invoice with
 * the online payment started (pay=1), so the same PayHere sheet and its
 * confirmation handling are used. Without online payment it opens the
 * invoice, which says how to pay instead.
 */
export function PayNow({ invoice, why }: { invoice: PayableInvoice; why: string }) {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  if (Number(invoice.balance) <= 0) return null;
  return (
    <View style={[styles.box, { borderColor: colors.brand, backgroundColor: colors.surface }]} testID={`pay-${invoice.id}`}>
      <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>{t('payNow.amount', { amount: formatLkr(invoice.balance), number: invoice.number ?? '' })}</Text>
      <Text style={{ fontSize: 14, color: colors.muted }}>
        {why}
        {invoice.dueDate ? ` ${t('payNow.due', { date: formatDate(invoice.dueDate, locale) })}` : ''}
      </Text>
      <Button
        icon={invoice.canPayOnline ? 'card-outline' : undefined}
        variant={invoice.canPayOnline ? 'primary' : 'secondary'}
        label={invoice.canPayOnline ? t('payNow.button') : t('payNow.view')}
        onPress={() => router.push({ pathname: '/invoices/[id]', params: invoice.canPayOnline ? { id: invoice.id, pay: '1' } : { id: invoice.id } })}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { borderWidth: 1, borderRadius: 10, padding: 12, gap: 6, marginTop: 8 },
});
