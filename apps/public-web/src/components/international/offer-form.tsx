'use client';

import { useState } from 'react';
import {
  CURRENCY_CODES,
  OFFER_LIMITS,
  accommodationValues,
  flightsPaidByValues,
  salaryPeriodValues,
  type CountryCode,
  type CurrencyCode,
  type OfferInput,
  type OfferTerms,
} from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useCountryNames } from '@/lib/countries';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input, Label, RequiredLegend, Select, Textarea } from '@/components/ui/input';

type Draft = Omit<OfferInput, 'contractMonths' | 'hoursPerWeek' | 'salaryAmount' | 'annualLeaveDays' | 'probationMonths'> & {
  contractMonths: string;
  hoursPerWeek: string;
  salaryAmount: string;
  annualLeaveDays: string;
  probationMonths: string;
};

const fromTerms = (t: Partial<OfferTerms> & { expiresOn?: string | null }): Draft => ({
  jobTitle: t.jobTitle ?? '',
  country: (t.country ?? 'JP') as CountryCode,
  city: t.city ?? '',
  startDate: t.startDate ?? '',
  contractMonths: t.contractMonths ? String(t.contractMonths) : '24',
  hoursPerWeek: t.hoursPerWeek ? String(t.hoursPerWeek) : '40',
  salaryAmount: t.salaryAmount ? String(t.salaryAmount) : '',
  salaryCurrency: (t.salaryCurrency ?? 'USD') as CurrencyCode,
  salaryPeriod: t.salaryPeriod ?? 'MONTH',
  accommodation: t.accommodation ?? 'PROVIDED_FREE',
  mealsProvided: t.mealsProvided ?? false,
  flightsPaidBy: t.flightsPaidBy ?? 'EMPLOYER',
  annualLeaveDays: t.annualLeaveDays != null ? String(t.annualLeaveDays) : '',
  probationMonths: t.probationMonths != null ? String(t.probationMonths) : '',
  otherTerms: t.otherTerms ?? '',
  expiresOn: t.expiresOn ?? '',
  signatureName: '',
});

const num = (s: string) => (s.trim() === '' ? null : Number(s));

/**
 * The terms of a job offer, and the employer's typed signature. Signing again
 * is required whenever the terms change: the signature covers exactly these.
 */
export function OfferForm({
  initial,
  organisationName,
  talentFirstName,
  pending,
  error,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial: Partial<OfferTerms> & { expiresOn?: string | null };
  organisationName: string;
  talentFirstName: string;
  pending: boolean;
  error: unknown;
  submitLabel: string;
  onSubmit: (body: OfferInput) => void;
  onCancel?: () => void;
}) {
  const { t } = useTranslation();
  const countries = useCountryNames();
  const [d, setD] = useState<Draft>(() => fromTerms(initial));
  const [authorised, setAuthorised] = useState(false);
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => setD((x) => ({ ...x, [k]: v }));

  return (
    <form
      className="space-y-5"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({
          ...d,
          city: d.city?.trim() || null,
          startDate: d.startDate || null,
          expiresOn: d.expiresOn || null,
          otherTerms: d.otherTerms?.trim() || null,
          contractMonths: Number(d.contractMonths),
          hoursPerWeek: Number(d.hoursPerWeek),
          salaryAmount: Number(d.salaryAmount),
          annualLeaveDays: num(d.annualLeaveDays),
          probationMonths: num(d.probationMonths),
          signatureName: d.signatureName.trim(),
        });
      }}
    >
      <RequiredLegend label={t('employer.offers.form.required')} />
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-ink">{t('employer.offers.form.job')}</legend>
        <div className="sm:col-span-2">
          <Label htmlFor="o-title" required>
            {t('overseas.terms.jobTitle')}
          </Label>
          <Input id="o-title" value={d.jobTitle} onChange={(e) => set('jobTitle', e.target.value)} maxLength={OFFER_LIMITS.jobTitle} required />
        </div>
        <div>
          <Label htmlFor="o-country" required>
            {t('employer.offers.form.country')}
          </Label>
          <Select id="o-country" value={d.country} onChange={(e) => set('country', e.target.value as CountryCode)}>
            {countries.sorted.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="o-city">{t('employer.offers.form.city')}</Label>
          <Input id="o-city" value={d.city ?? ''} onChange={(e) => set('city', e.target.value)} maxLength={OFFER_LIMITS.city} />
        </div>
        <div>
          <Label htmlFor="o-start">{t('overseas.terms.startDate')}</Label>
          <Input id="o-start" type="date" value={d.startDate ?? ''} onChange={(e) => set('startDate', e.target.value)} />
          <p className="mt-1 text-xs text-ink/50">{t('employer.offers.form.startHint')}</p>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="o-months" required>
              {t('employer.offers.form.contractMonths')}
            </Label>
            <Input id="o-months" type="number" min={1} max={120} value={d.contractMonths} onChange={(e) => set('contractMonths', e.target.value)} required />
          </div>
          <div>
            <Label htmlFor="o-hours" required>
              {t('employer.offers.form.hours')}
            </Label>
            <Input id="o-hours" type="number" min={1} max={84} value={d.hoursPerWeek} onChange={(e) => set('hoursPerWeek', e.target.value)} required />
          </div>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="mb-2 text-sm font-semibold text-ink">{t('employer.offers.form.pay')}</legend>
        <div>
          <Label htmlFor="o-salary" required>
            {t('overseas.terms.salary')}
          </Label>
          <Input id="o-salary" type="number" min={0.01} step="0.01" value={d.salaryAmount} onChange={(e) => set('salaryAmount', e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="o-currency" required>
            {t('employer.offers.form.currency')}
          </Label>
          <Select id="o-currency" value={d.salaryCurrency} onChange={(e) => set('salaryCurrency', e.target.value as CurrencyCode)}>
            {CURRENCY_CODES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="o-period" required>
            {t('employer.offers.form.period')}
          </Label>
          <Select id="o-period" value={d.salaryPeriod} onChange={(e) => set('salaryPeriod', e.target.value as Draft['salaryPeriod'])}>
            {salaryPeriodValues.map((p) => (
              <option key={p} value={p}>
                {t(`employer.vacancies.form.periods.${p}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="o-acc" required>
            {t('overseas.terms.accommodation')}
          </Label>
          <Select id="o-acc" value={d.accommodation} onChange={(e) => set('accommodation', e.target.value as Draft['accommodation'])}>
            {accommodationValues.map((a) => (
              <option key={a} value={a}>
                {t(`overseas.accommodation.${a}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="o-flights" required>
            {t('overseas.terms.flights')}
          </Label>
          <Select id="o-flights" value={d.flightsPaidBy} onChange={(e) => set('flightsPaidBy', e.target.value as Draft['flightsPaidBy'])}>
            {flightsPaidByValues.map((f) => (
              <option key={f} value={f}>
                {t(`overseas.flights.${f}`)}
              </option>
            ))}
          </Select>
        </div>
        <label className="flex items-center gap-2 self-end pb-2 text-sm text-ink">
          <input type="checkbox" checked={d.mealsProvided} onChange={(e) => set('mealsProvided', e.target.checked)} className="h-4 w-4 accent-brand" />
          {t('employer.offers.form.meals')}
        </label>
        <div>
          <Label htmlFor="o-leave">{t('employer.offers.form.leave')}</Label>
          <Input id="o-leave" type="number" min={0} max={60} value={d.annualLeaveDays} onChange={(e) => set('annualLeaveDays', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="o-prob">{t('employer.offers.form.probation')}</Label>
          <Input id="o-prob" type="number" min={0} max={12} value={d.probationMonths} onChange={(e) => set('probationMonths', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="o-expires">{t('employer.offers.form.expires')}</Label>
          <Input id="o-expires" type="date" value={d.expiresOn ?? ''} onChange={(e) => set('expiresOn', e.target.value)} />
          <p className="mt-1 text-xs text-ink/50">{t('employer.offers.form.expiresHint')}</p>
        </div>
        <div className="sm:col-span-3">
          <Label htmlFor="o-other">{t('overseas.terms.other')}</Label>
          <Textarea id="o-other" value={d.otherTerms ?? ''} onChange={(e) => set('otherTerms', e.target.value)} maxLength={OFFER_LIMITS.otherTerms} rows={4} placeholder={t('employer.offers.form.otherPlaceholder')} />
        </div>
      </fieldset>

      <fieldset className="space-y-3 rounded-lg border border-border bg-paper p-4">
        <legend className="px-1 text-sm font-semibold text-ink">{t('employer.offers.form.sign')}</legend>
        <p className="text-sm text-ink/70">{t('employer.offers.form.signIntro', { name: talentFirstName })}</p>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" checked={authorised} onChange={(e) => setAuthorised(e.target.checked)} className="mt-1 h-4 w-4 accent-brand" />
          {t('employer.offers.form.authorised', { organisation: organisationName })}
        </label>
        <div>
          <Label htmlFor="o-sign" required>
            {t('employer.offers.form.signature')}
          </Label>
          <Input id="o-sign" value={d.signatureName} onChange={(e) => set('signatureName', e.target.value)} maxLength={OFFER_LIMITS.signature} autoComplete="name" className="max-w-sm bg-white font-serif text-lg italic" required />
        </div>
      </fieldset>

      {error ? (
        <p role="alert" className="text-sm text-danger">
          {error instanceof ApiError ? error.message : t('portal.saveError')}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={pending || !authorised || d.signatureName.trim().length < 2}>
          {submitLabel}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        )}
      </div>
    </form>
  );
}
