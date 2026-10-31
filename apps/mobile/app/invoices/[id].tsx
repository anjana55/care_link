import { useEffect, useState } from 'react';
import { ActivityIndicator, Linking, ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { formatLkr, type ClientInvoice, type PayhereCheckout } from '@care-platform/shared';
import { ApiError } from '@/api';
import { config } from '@/config';
import { useAuth } from '@/auth/AuthProvider';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button, Field, FormError, Screen } from '@/ui/controls';
import { Text } from '@/ui/Text';
import { formatDate } from '@/ui/dates';
import { useMyInvoice, useStartOnlinePayment } from '@/care/billing-api';
import { PayhereSheet, webViewAvailable, type PayhereOutcome } from '@/care/PayhereSheet';

/** After a manual close, how long to keep checking whether a payment came through. */
const QUIET_CHECK_MS = 60_000;

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * One invoice, as on the website: the pay-online section when the agency
 * offers it, then the invoice itself. After PayHere, it waits for PayHere's
 * own confirmation to reach us (asking every few seconds) rather than
 * trusting the return.
 */
export default function InvoiceScreen() {
  const { t, locale } = useTranslation();
  const colors = useColors();
  const router = useRouter();
  const { user } = useAuth();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [payment, setPayment] = useState<PayhereOutcome | null>(null);
  const { data: invoice, isLoading, isError, refetch } = useMyInvoice(id ?? null, payment === 'return' || payment === 'closed');
  const start = useStartOnlinePayment(id ?? '');
  const [checkout, setCheckout] = useState<PayhereCheckout | null>(null);
  const [email, setEmail] = useState('');

  // A manual close only checks quietly for a while; a real return keeps waiting for PayHere.
  useEffect(() => {
    if (payment !== 'closed') return;
    const timer = setTimeout(() => setPayment(null), QUIET_CHECK_MS);
    return () => clearTimeout(timer);
  }, [payment]);

  const back = <Button variant="link" label={`‹ ${t('invoices.back')}`} onPress={() => (router.canGoBack?.() ? router.back() : router.replace('/invoices'))} />;

  if (isLoading) {
    return (
      <Screen>
        {back}
        <ActivityIndicator color={colors.brand} style={{ marginTop: 40 }} />
      </Screen>
    );
  }
  if (isError || !invoice) {
    return (
      <Screen>
        {back}
        <View accessibilityRole="alert" style={{ gap: 12, marginTop: 24 }}>
          <Text style={{ color: colors.ink, fontSize: 17 }}>{t('error.title')}</Text>
          <Button variant="secondary" label={t('error.retry')} onPress={() => refetch()} />
        </View>
      </Screen>
    );
  }

  const needEmail = !user?.email && !invoice.billTo.email;
  const emailOk = !needEmail || EMAIL.test(email.trim());

  const pay = () => {
    // A build made before the WebView was added can't show PayHere: the website takes the payment.
    if (!webViewAvailable()) {
      Linking.openURL(`${config.siteUrl}/account/invoices/${invoice.id}`).catch(() => undefined);
      return;
    }
    setPayment(null);
    start.mutate(needEmail ? email.trim() : undefined, { onSuccess: setCheckout });
  };

  return (
    <Screen>
      <ScrollView contentContainerStyle={styles.page}>
        {back}

        {payment === 'return' ? (
          <View accessibilityLiveRegion="polite" style={[styles.notice, { borderColor: colors.brand }]}>
            {invoice.status === 'PAID' ? null : <ActivityIndicator color={colors.brand} />}
            <Text style={{ flex: 1, color: colors.ink, fontSize: 15, lineHeight: 22 }}>
              {invoice.status === 'PAID' ? t('invoices.pay.thanks') : t('invoices.pay.confirming')}
            </Text>
          </View>
        ) : null}
        {payment === 'closed' && invoice.status === 'PAID' ? (
          <Text accessibilityLiveRegion="polite" style={[styles.notice, { borderColor: colors.brand, color: colors.ink }]}>
            {t('invoices.pay.thanks')}
          </Text>
        ) : null}
        {payment === 'cancelled' && invoice.status === 'ISSUED' ? (
          <Text style={[styles.notice, { borderColor: colors.border, color: colors.muted }]}>{t('invoices.pay.cancelled')}</Text>
        ) : null}

        {invoice.canPayOnline ? (
          <View style={[styles.pay, { borderColor: colors.brand, backgroundColor: colors.surface }]}>
            <Text accessibilityRole="header" style={{ fontSize: 18, fontWeight: '700', color: colors.ink }}>
              {t('invoices.pay.title', { amount: formatLkr(invoice.balance) })}
            </Text>
            <Text style={{ fontSize: 14, color: colors.muted }}>{t('invoices.pay.hint')}</Text>
            {needEmail ? (
              <Field
                label={t('invoices.pay.email')}
                hint={t('invoices.pay.emailHint')}
                value={email}
                onChangeText={setEmail}
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                autoComplete="email"
              />
            ) : null}
            <FormError message={start.isError ? (start.error instanceof ApiError && start.error.message ? start.error.message : t('invoices.pay.error')) : null} />
            <Button
              label={start.isPending ? t('invoices.pay.redirecting') : t('invoices.pay.button')}
              busy={start.isPending}
              disabled={!emailOk}
              onPress={pay}
            />
          </View>
        ) : invoice.status === 'ISSUED' ? (
          <Text style={[styles.notice, { borderColor: colors.border, color: colors.muted }]}>{t('invoices.pay.offline')}</Text>
        ) : null}

        <InvoiceView invoice={invoice} locale={locale} />
      </ScrollView>

      <PayhereSheet
        checkout={checkout}
        onFinish={(outcome) => {
          setCheckout(null);
          setPayment(outcome);
          void refetch();
        }}
      />
    </Screen>
  );
}

/** The invoice itself, laid out for a phone (the website's phone layout). */
function InvoiceView({ invoice: inv, locale }: { invoice: ClientInvoice; locale: string }) {
  const { t } = useTranslation();
  const colors = useColors();
  const s = inv.seller;
  const taxed = Boolean(inv.taxRate);
  const money = (v: string) => formatLkr(v).replace('LKR ', '');
  const muted = { color: colors.muted, fontSize: 14, lineHeight: 20 };

  return (
    <View style={[styles.doc, { borderColor: colors.border, backgroundColor: colors.surface }]}>
      {inv.status === 'VOID' ? <Text style={[styles.void, { color: colors.danger, borderColor: colors.danger }]}>{t('invoices.doc.void')}</Text> : null}

      <View style={{ gap: 2 }}>
        <Text style={{ fontSize: 22, fontWeight: '700', color: colors.brand }}>{taxed ? t('invoices.doc.taxInvoice') : t('invoices.doc.invoice')}</Text>
        <Text style={{ fontSize: 17, fontWeight: '600', color: colors.ink }}>{inv.number}</Text>
        <Text style={muted}>
          {t('invoices.doc.issued')}: {formatDate(inv.issueDate, locale)}
        </Text>
        <Text style={[muted, inv.overdue && { color: colors.danger, fontWeight: '600' }]}>
          {t('invoices.doc.due')}: {formatDate(inv.dueDate, locale)}
        </Text>
        {inv.periodStart && inv.periodEnd ? (
          <Text style={muted}>
            {t('invoices.doc.period')}: {formatDate(inv.periodStart, locale)} – {formatDate(inv.periodEnd, locale)}
          </Text>
        ) : null}
        {inv.bookingReference ? (
          <Text style={muted}>
            {t('invoices.doc.booking')}: {inv.bookingReference}
          </Text>
        ) : null}
      </View>

      <View style={[styles.section, { borderColor: colors.border }]}>
        <Text style={{ fontSize: 16, fontWeight: '700', color: colors.ink }}>{s.name}</Text>
        {s.address ? <Text style={muted}>{s.address}</Text> : null}
        {s.phone || s.email ? <Text style={muted}>{[s.phone, s.email].filter(Boolean).join(' · ')}</Text> : null}
        {s.registrationNumber ? <Text style={muted}>{t('invoices.doc.regNo', { number: s.registrationNumber })}</Text> : null}
        {taxed && s.taxRegistrationNumber ? <Text style={muted}>{t('invoices.doc.taxRegNo', { name: inv.taxName ?? '', number: s.taxRegistrationNumber })}</Text> : null}
      </View>

      <View style={[styles.section, { borderColor: colors.border }]}>
        <Text style={[styles.label, { color: colors.muted }]}>{t('invoices.doc.billTo')}</Text>
        <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>{inv.billTo.name}</Text>
        {inv.billTo.address ? <Text style={muted}>{inv.billTo.address}</Text> : null}
        {inv.billTo.phone || inv.billTo.email ? <Text style={muted}>{[inv.billTo.phone, inv.billTo.email].filter(Boolean).join(' · ')}</Text> : null}
      </View>

      <View style={[styles.section, { borderColor: colors.border }]}>
        {inv.lines.map((l, i) => (
          <View key={i} style={[styles.line, { borderColor: colors.border }]}>
            <View style={styles.row}>
              <Text style={{ flex: 1, fontSize: 15, color: colors.ink }}>{l.description}</Text>
              <Text style={{ fontSize: 15, fontWeight: '600', color: colors.ink }}>{money(l.amount)}</Text>
            </View>
            <Text style={muted}>
              {[l.serviceDate ? formatDate(l.serviceDate, locale) : null, `${Number(l.quantity)} ${t(`invoices.unit.${l.unit}`)} × ${money(l.unitPrice)}`].filter(Boolean).join(' · ')}
            </Text>
            {Number(l.discount) > 0 ? <Text style={muted}>{t('invoices.doc.lineDiscount', { amount: formatLkr(l.discount) })}</Text> : null}
          </View>
        ))}
      </View>

      <View style={[styles.section, { borderColor: colors.border }]}>
        <Row label={t('invoices.doc.subtotal')} value={formatLkr(inv.subtotal)} />
        {Number(inv.discount) > 0 ? (
          <Row label={inv.discountLabel ? `${t('invoices.doc.discount')} (${inv.discountLabel})` : t('invoices.doc.discount')} value={`−${formatLkr(inv.discount)}`} />
        ) : null}
        {taxed ? <Row label={`${inv.taxName} ${Number(inv.taxRate)}%`} value={formatLkr(inv.tax)} /> : null}
        <Row label={t('invoices.doc.total')} value={formatLkr(inv.total)} strong />
        {Number(inv.amountPaid) !== 0 ? <Row label={t('invoices.doc.paid')} value={`−${formatLkr(inv.amountPaid)}`} /> : null}
        {Number(inv.amountPaid) !== 0 ? <Row label={t('invoices.doc.balance')} value={formatLkr(inv.balance)} strong /> : null}
      </View>

      {inv.status === 'PAID' ? <Text style={{ fontSize: 16, fontWeight: '700', color: colors.brand, textAlign: 'right' }}>{t('invoices.doc.paidInFull')}</Text> : null}

      {inv.payments.length ? (
        <View style={[styles.section, { borderColor: colors.border }]}>
          <Text style={[styles.label, { color: colors.muted }]}>{t('invoices.doc.payments')}</Text>
          {inv.payments.map((p, i) => (
            <View key={i} style={styles.row}>
              <Text style={[muted, { flex: 1 }]}>
                {formatDate(p.paidOn, locale)} · {t(`invoices.paymentType.${p.paymentType}`)}
                {p.method && p.method !== 'CASH' ? ` (${t(`invoices.method.${p.method}`)})` : ''}
                {p.reference ? ` · ${p.reference}` : ''}
              </Text>
              <Text style={{ color: colors.ink }}>{formatLkr(p.amount)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {inv.notes ? <Text style={{ fontSize: 15, lineHeight: 22, color: colors.ink }}>{inv.notes}</Text> : null}
      {inv.footer ? <Text style={[muted, { fontSize: 12 }]}>{inv.footer}</Text> : null}
    </View>
  );
}

function Row({ label, value, strong = false }: { label: string; value: string; strong?: boolean }) {
  const colors = useColors();
  return (
    <View style={[styles.row, { paddingVertical: 3 }]}>
      <Text style={{ fontSize: strong ? 17 : 15, fontWeight: strong ? '700' : '400', color: strong ? colors.ink : colors.muted }}>{label}</Text>
      <Text style={{ fontSize: strong ? 17 : 15, fontWeight: strong ? '700' : '400', color: colors.ink }}>{value}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  page: { paddingBottom: 40, gap: 14 },
  notice: { flexDirection: 'row', alignItems: 'center', gap: 10, borderLeftWidth: 4, paddingLeft: 12, paddingVertical: 8, fontSize: 15, lineHeight: 22 },
  pay: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 10 },
  doc: { borderWidth: 1, borderRadius: 14, padding: 16, gap: 14 },
  void: { borderWidth: 1, borderRadius: 8, padding: 8, textAlign: 'center', fontWeight: '700', textTransform: 'uppercase' },
  section: { borderTopWidth: StyleSheet.hairlineWidth, paddingTop: 12, gap: 3 },
  label: { fontSize: 12, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' },
  line: { paddingVertical: 6, gap: 2 },
  row: { flexDirection: 'row', justifyContent: 'space-between', gap: 12 },
});
