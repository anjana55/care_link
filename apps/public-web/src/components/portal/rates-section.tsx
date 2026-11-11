'use client';

import { useState } from 'react';
import { clientPriceFor, rateProblem, type CareType, type CaregiverRateLine } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { ApiError } from '@/lib/api/client';
import { useRateCard, useSaveRates } from '@/lib/hooks/use-caregiver-portal';

const money = (n: number) => n.toLocaleString('en-LK');

/**
 * "Your rates": one amount per kind of care the caregiver takes on, where the
 * office has switched own rates on. Each field says the limits and, as they
 * type, what clients will be shown. Nothing renders while own rates are off
 * for every kind of care, so the profile looks as it did before.
 */
export function RatesSection() {
  const { t } = useTranslation();
  const { data } = useRateCard();
  const save = useSaveRates();
  const [drafts, setDrafts] = useState<Partial<Record<CareType, string>>>({});
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const lines = data?.lines.filter((l) => l.pricing.enabled && l.offered) ?? [];
  if (!data || !lines.length) return null;
  const others = data.lines.some((l) => l.offered && !l.pricing.enabled);

  const valueOf = (l: CaregiverRateLine) => drafts[l.careType] ?? (l.amount === null ? '' : String(l.amount));
  const problemOf = (l: CaregiverRateLine) => {
    const v = valueOf(l).trim();
    if (v === '') return null;
    return /^\d+(\.\d{1,2})?$/.test(v) ? rateProblem(Number(v), l.pricing) : 'NOT_A_NUMBER';
  };
  const changed = lines.filter((l) => drafts[l.careType] !== undefined && drafts[l.careType]!.trim() !== (l.amount === null ? '' : String(l.amount)));
  const blocked = changed.some((l) => problemOf(l));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!changed.length || blocked) return;
    save.mutate(
      changed.map((l) => ({ careType: l.careType, amount: valueOf(l).trim() === '' ? null : Number(valueOf(l)) })),
      { onSuccess: () => (setDrafts({}), setSaved(true), setError(null)), onError: (err) => setError(err instanceof ApiError ? err.message : t('portal.saveError')) },
    );
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-border bg-white p-5" noValidate>
      <div>
        <h2 className="text-sm font-semibold text-ink">{t('portal.rates.title')}</h2>
        <p className="mt-1 text-xs text-ink/60">{t('portal.rates.hint')}</p>
      </div>
      {lines.map((l) => {
        const unit = t(`portal.rates.units.${l.pricing.rateType}`);
        const problem = problemOf(l);
        const v = valueOf(l).trim();
        const live = v !== '' && !problem ? clientPriceFor(Number(v), l.pricing.feePercent) : null;
        const id = `my-rate-${l.careType}`;
        return (
          <div key={l.careType}>
            <label htmlFor={id} className="mb-1 block text-sm font-medium text-ink">
              {t(`careTypes.${l.careType}`)}
            </label>
            <div className="flex flex-wrap items-center gap-3">
              <input
                id={id}
                inputMode="decimal"
                value={valueOf(l)}
                aria-invalid={Boolean(problem)}
                aria-describedby={`${id}-hint`}
                aria-label={`${t(`careTypes.${l.careType}`)}: ${t('portal.rates.rate')}`}
                onChange={(e) => (setSaved(false), setError(null), setDrafts({ ...drafts, [l.careType]: e.target.value }))}
                className="h-11 w-40 rounded border border-border bg-white px-3 text-base text-ink focus:outline-none focus:ring-2 focus:ring-brand"
              />
              <span className="text-sm text-ink/70">{unit}</span>
            </div>
            <p id={`${id}-hint`} className="mt-1 text-xs text-ink/60">
              {t('portal.rates.band', { min: money(l.pricing.minRate), max: money(l.pricing.maxRate), unit })}
              {problem === 'TOO_LOW' && <span className="block text-danger">{t('portal.rates.tooLow')}</span>}
              {problem === 'TOO_HIGH' && <span className="block text-danger">{t('portal.rates.tooHigh')}</span>}
              {problem === 'NOT_A_NUMBER' && <span className="block text-danger">{t('portal.rates.invalid')}</span>}
              {live !== null && <span className="block text-sm text-ink">{t('portal.rates.clientSees', { price: money(live), unit })}</span>}
              {l.outOfBand && drafts[l.careType] === undefined && <span className="block text-danger">{t('portal.rates.outOfBand')}</span>}
            </p>
          </div>
        );
      })}
      {others && <p className="text-xs text-ink/60">{t('portal.rates.office')}</p>}
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <button
          type="submit"
          disabled={save.isPending || !changed.length || blocked}
          className="inline-flex h-11 items-center rounded bg-brand px-5 text-sm font-medium text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {save.isPending ? t('common.loading') : t('portal.rates.save')}
        </button>
        {saved && !changed.length && (
          <span role="status" className="text-sm text-brand-dark">
            {t('portal.rates.saved')}
          </span>
        )}
      </div>
    </form>
  );
}
