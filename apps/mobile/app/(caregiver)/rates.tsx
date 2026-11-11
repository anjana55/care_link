import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, View } from 'react-native';
import { clientPriceFor, rateProblem, type CareType, type CaregiverRateLine } from '@care-platform/shared';
import { ApiError } from '@/api';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button, Field, FormError, Screen } from '@/ui/controls';
import { Text } from '@/ui/Text';
import { Card, EmptyState } from '@/ui/visual';
import { useRateCard, useSaveRates } from '@/caregiver/api';

const money = (n: number) => n.toLocaleString('en-LK');

/**
 * "Your rates" (the website's section on the caregiver's profile): one amount
 * per kind of care the caregiver takes on, where the office has switched own
 * rates on. Each field says the limits and, as they type, what clients will
 * be shown.
 */
export default function Rates() {
  const { t } = useTranslation();
  const colors = useColors();
  const card = useRateCard();
  const save = useSaveRates();
  const [drafts, setDrafts] = useState<Partial<Record<CareType, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const lines = card.data?.lines.filter((l) => l.pricing.enabled && l.offered) ?? [];
  const others = card.data?.lines.some((l) => l.offered && !l.pricing.enabled) ?? false;
  const valueOf = (l: CaregiverRateLine) => drafts[l.careType] ?? (l.amount === null ? '' : String(l.amount));
  const problemOf = (l: CaregiverRateLine) => {
    const v = valueOf(l).trim();
    if (v === '') return null;
    return /^\d+(\.\d{1,2})?$/.test(v) ? rateProblem(Number(v), l.pricing) : 'NOT_A_NUMBER';
  };
  const changed = lines.filter((l) => drafts[l.careType] !== undefined && drafts[l.careType]!.trim() !== (l.amount === null ? '' : String(l.amount)));
  const blocked = changed.some((l) => problemOf(l));

  const submit = () =>
    save.mutate(
      changed.map((l) => ({ careType: l.careType, amount: valueOf(l).trim() === '' ? null : Number(valueOf(l)) })),
      { onSuccess: () => (setDrafts({}), setSaved(true), setError(null)), onError: (err) => setError(err instanceof ApiError && err.message ? err.message : t('portal.saveError')) },
    );

  return (
    <Screen title={t('portal.rates.title')} subtitle={t('portal.rates.hint')}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {card.isError ? <FormError message={t('portal.loadError')} /> : null}
          {card.data && !lines.length ? <EmptyState icon="cash-outline" body={t('portal.rates.office')} /> : null}
          {lines.map((l) => {
            const unit = t(`portal.rates.units.${l.pricing.rateType}`);
            const problem = problemOf(l);
            const v = valueOf(l).trim();
            const live = v !== '' && !problem ? clientPriceFor(Number(v), l.pricing.feePercent) : null;
            const stale = l.outOfBand && drafts[l.careType] === undefined;
            return (
              <Card key={l.careType} style={{ gap: 8 }}>
                <Field
                  label={`${t(`careTypes.${l.careType}`)} (${t('portal.rates.rate')}, ${unit})`}
                  keyboardType="decimal-pad"
                  value={valueOf(l)}
                  onChangeText={(text) => (setSaved(false), setError(null), setDrafts({ ...drafts, [l.careType]: text }))}
                  hint={t('portal.rates.band', { min: money(l.pricing.minRate), max: money(l.pricing.maxRate), unit })}
                  error={
                    // A saved rate the limits have since moved away from: say that, not "too low".
                    stale
                      ? t('portal.rates.outOfBand')
                      : problem === 'TOO_LOW'
                        ? t('portal.rates.tooLow')
                        : problem === 'TOO_HIGH'
                          ? t('portal.rates.tooHigh')
                          : problem === 'NOT_A_NUMBER'
                            ? t('portal.rates.invalid')
                            : null
                  }
                />
                {live !== null ? <Text style={{ fontSize: 16, fontWeight: '600', color: colors.ink }}>{t('portal.rates.clientSees', { price: money(live), unit })}</Text> : null}
              </Card>
            );
          })}
          {lines.length && others ? <Text style={{ fontSize: 14, lineHeight: 20, color: colors.muted }}>{t('portal.rates.office')}</Text> : null}
          <FormError message={error} />
          {lines.length ? (
            <View style={{ gap: 8 }}>
              <Button label={t('portal.rates.save')} busy={save.isPending} disabled={!changed.length || blocked} onPress={submit} />
              {saved && !changed.length ? (
                <Text accessibilityLiveRegion="polite" style={{ fontSize: 15, color: colors.brand }}>
                  {t('portal.rates.saved')}
                </Text>
              ) : null}
            </View>
          ) : null}
        </ScrollView>
      </KeyboardAvoidingView>
    </Screen>
  );
}

const styles = StyleSheet.create({
  body: { paddingTop: 20, paddingBottom: 40, gap: 16 },
});
