'use client';

import { useState } from 'react';
import { clientPriceFor, rateProblem, type CareType, type CaregiverRateLine } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { useCaregiverRates, useSaveCaregiverRates } from '@/lib/hooks/use-pricing';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';

const money = (n: number) => n.toLocaleString('en-LK');

/**
 * A caregiver's rate card on their staff page: what they ask for each kind
 * of care, the limits, and what the client is shown. Staff can set a rate on
 * the caregiver's behalf (someone who phones in rather than using the app).
 */
export function CaregiverRatesCard({ caregiverId, canEdit }: { caregiverId: string; canEdit: boolean }) {
  const { t } = useTranslation();
  const { data } = useCaregiverRates(caregiverId);
  const save = useSaveCaregiverRates(caregiverId);
  const [drafts, setDrafts] = useState<Partial<Record<CareType, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  if (!data) return null;
  const anyEnabled = data.lines.some((l) => l.pricing.enabled);
  const valueOf = (l: CaregiverRateLine) => drafts[l.careType] ?? (l.amount === null ? '' : String(l.amount));
  const problemOf = (l: CaregiverRateLine) => {
    const v = valueOf(l).trim();
    if (v === '') return null;
    return /^\d+(\.\d{1,2})?$/.test(v) ? rateProblem(Number(v), l.pricing) : 'NOT_A_NUMBER';
  };
  const changed = data.lines.filter((l) => drafts[l.careType] !== undefined && drafts[l.careType]!.trim() !== (l.amount === null ? '' : String(l.amount)));
  const blocked = changed.some((l) => problemOf(l));

  const submit = () =>
    save.mutate(
      changed.map((l) => ({ careType: l.careType, amount: valueOf(l).trim() === '' ? null : Number(valueOf(l)) })),
      { onSuccess: () => (setDrafts({}), setSaved(true), setError(null)), onError: (err) => setError(err instanceof ApiError && err.message ? err.message : t('pricing.error')) },
    );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('pricing.card.title')}</CardTitle>
        <p className="mt-1 text-xs text-ink/60">{anyEnabled ? t('pricing.card.hint') : t('pricing.card.allOffice')}</p>
      </CardHeader>
      {anyEnabled && (
        <CardContent>
          <ul>
            {data.lines.map((l) => {
              const unit = t(`pricing.units.${l.pricing.rateType}`);
              const problem = problemOf(l);
              const v = valueOf(l).trim();
              const live = v !== '' && !problem ? clientPriceFor(Number(v), l.pricing.feePercent) : null;
              const inputId = `rate-${l.careType}`;
              return (
                <li key={l.careType} className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border py-2 first:border-t-0">
                  <label htmlFor={inputId} className="min-w-0 flex-1 basis-56 text-sm text-ink">
                    {t(`careTypes.${l.careType}`)}
                    {!l.offered && <span className="block text-xs text-ink/50">{t('pricing.card.notOffered')}</span>}
                  </label>
                  {!l.pricing.enabled ? (
                    <span className="text-sm text-ink/50">{t('pricing.card.office')}</span>
                  ) : (
                    <>
                      <span className="w-32">
                        {canEdit ? (
                          <Input
                            id={inputId}
                            inputMode="decimal"
                            className="h-9"
                            value={valueOf(l)}
                            placeholder={t('pricing.card.notSet')}
                            aria-label={`${t(`careTypes.${l.careType}`)}: ${t('pricing.card.rate')}`}
                            aria-invalid={Boolean(problem)}
                            aria-describedby={`${inputId}-hint`}
                            onChange={(e) => (setSaved(false), setError(null), setDrafts({ ...drafts, [l.careType]: e.target.value }))}
                          />
                        ) : (
                          <span className="text-sm tabular-nums text-ink">{l.amount === null ? t('pricing.card.notSet') : `LKR ${money(l.amount)}`}</span>
                        )}
                      </span>
                      <span id={`${inputId}-hint`} className="basis-64 text-xs text-ink/60">
                        {t('pricing.card.band', { min: money(l.pricing.minRate), max: money(l.pricing.maxRate), unit })}
                        {problem === 'TOO_LOW' && <span className="block text-danger">{t('pricing.card.tooLow')}</span>}
                        {problem === 'TOO_HIGH' && <span className="block text-danger">{t('pricing.card.tooHigh')}</span>}
                        {live !== null && <span className="block text-ink">{t('pricing.card.clientSees', { price: money(live), unit })}</span>}
                        {l.outOfBand && drafts[l.careType] === undefined && <span className="block text-danger">{t('pricing.card.outOfBand')}</span>}
                      </span>
                    </>
                  )}
                </li>
              );
            })}
          </ul>
          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}
          {canEdit && (
            <div className="mt-3 flex items-center gap-3">
              <Button size="sm" disabled={save.isPending || !changed.length || blocked} onClick={submit}>
                {save.isPending ? t('common.loading') : t('pricing.save')}
              </Button>
              {saved && !changed.length && (
                <span role="status" className="text-sm text-brand-dark">
                  {t('pricing.saved')}
                </span>
              )}
            </div>
          )}
        </CardContent>
      )}
    </Card>
  );
}
