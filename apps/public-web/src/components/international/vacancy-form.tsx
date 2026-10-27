'use client';

import { useState } from 'react';
import {
  CURRENCY_CODES,
  VACANCY_LIMITS,
  careTypeValues,
  englishLevelValues,
  salaryPeriodValues,
  visaSponsorshipValues,
  type CareType,
  type CountryCode,
  type CurrencyCode,
  type EnglishLevel,
  type SalaryPeriod,
  type Vacancy,
  type VacancyInput,
  type VisaSponsorship,
} from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useCountryNames } from '@/lib/countries';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input, Label, RequiredLegend, Select, Textarea } from '@/components/ui/input';

interface FormState {
  title: string;
  country: CountryCode | '';
  city: string;
  careSetting: CareType | '';
  rolesCount: string;
  description: string;
  requirements: string;
  minExperienceYears: string;
  englishLevel: EnglishLevel;
  salaryMin: string;
  salaryMax: string;
  salaryCurrency: CurrencyCode;
  salaryPeriod: SalaryPeriod;
  contractMonths: string;
  accommodation: '' | 'yes' | 'no';
  visaSponsorship: VisaSponsorship;
  startTimeframe: string;
  closesOn: string;
}

const fromVacancy = (v: Vacancy | undefined, defaultCountry: string | undefined): FormState => ({
  title: v?.title ?? '',
  country: ((v?.country ?? defaultCountry ?? '') as CountryCode) || '',
  city: v?.city ?? '',
  careSetting: (v?.careSetting as CareType) ?? '',
  rolesCount: String(v?.rolesCount ?? 1),
  description: v?.description ?? '',
  requirements: v?.requirements ?? '',
  minExperienceYears: String(v?.minExperienceYears ?? 1),
  englishLevel: v?.englishLevel ?? 'CONVERSATIONAL',
  salaryMin: v?.salaryMin != null ? String(v.salaryMin) : '',
  salaryMax: v?.salaryMax != null ? String(v.salaryMax) : '',
  salaryCurrency: ((v?.salaryCurrency as CurrencyCode) ?? 'USD') || 'USD',
  salaryPeriod: v?.salaryPeriod ?? 'MONTH',
  contractMonths: v?.contractMonths != null ? String(v.contractMonths) : '',
  accommodation: v?.accommodationProvided == null ? '' : v.accommodationProvided ? 'yes' : 'no',
  visaSponsorship: v?.visaSponsorship ?? 'YES',
  startTimeframe: v?.startTimeframe ?? '',
  closesOn: v?.closesOn ?? '',
});

/**
 * The vacancy an employer posts (or changes while it waits for review). Our
 * team checks every vacancy before it goes on the board.
 */
export function VacancyForm({
  vacancy,
  defaultCountry,
  pending,
  error,
  onSubmit,
}: {
  vacancy?: Vacancy;
  defaultCountry?: string;
  pending: boolean;
  error: unknown;
  onSubmit: (body: VacancyInput) => void;
}) {
  const { t } = useTranslation();
  const countries = useCountryNames();
  const [f, setF] = useState<FormState>(() => fromVacancy(vacancy, defaultCountry));
  const [problem, setProblem] = useState<string | null>(null);
  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setProblem(null);
    setF((prev) => ({ ...prev, [key]: value }));
  };
  const num = (s: string) => (s.trim() === '' ? null : Number(s));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const roles = Number(f.rolesCount);
    const min = num(f.salaryMin);
    const max = num(f.salaryMax);
    if (f.title.trim().length < 3 || !f.country || !f.careSetting || f.description.trim().length < 20) return setProblem(t('employer.vacancies.form.missing'));
    if (!Number.isInteger(roles) || roles < 1 || roles > 200) return setProblem(t('employer.vacancies.form.badRoles'));
    if ((min !== null && (Number.isNaN(min) || min < 0)) || (max !== null && (Number.isNaN(max) || max < 0)) || (min !== null && max !== null && max < min)) {
      return setProblem(t('employer.vacancies.form.badSalary'));
    }
    onSubmit({
      title: f.title.trim(),
      country: f.country,
      city: f.city.trim() || null,
      careSetting: f.careSetting,
      rolesCount: roles,
      description: f.description.trim(),
      requirements: f.requirements.trim() || null,
      minExperienceYears: Number(f.minExperienceYears) || 0,
      englishLevel: f.englishLevel,
      salaryMin: min,
      salaryMax: max,
      salaryCurrency: min !== null || max !== null ? f.salaryCurrency : null,
      salaryPeriod: min !== null || max !== null ? f.salaryPeriod : null,
      contractMonths: num(f.contractMonths),
      accommodationProvided: f.accommodation === '' ? null : f.accommodation === 'yes',
      visaSponsorship: f.visaSponsorship,
      startTimeframe: f.startTimeframe.trim() || null,
      closesOn: f.closesOn || null,
    });
  };

  const message = problem ?? (error ? (error instanceof ApiError ? error.message : t('portal.saveError')) : null);

  return (
    <form noValidate onSubmit={submit} className="space-y-6 rounded-lg border border-border bg-white p-6">
      <RequiredLegend label={t('common.requiredField')} />
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-ink">{t('employer.vacancies.form.role')}</legend>
        <div className="sm:col-span-2">
          <Label htmlFor="vf-title" required>
            {t('employer.vacancies.form.title')}
          </Label>
          <Input id="vf-title" value={f.title} maxLength={VACANCY_LIMITS.title} onChange={(e) => set('title', e.target.value)} placeholder={t('employer.vacancies.form.titlePlaceholder')} />
        </div>
        <div>
          <Label htmlFor="vf-setting" required>
            {t('employer.vacancies.form.setting')}
          </Label>
          <Select id="vf-setting" value={f.careSetting} onChange={(e) => set('careSetting', e.target.value as CareType)}>
            <option value="">{t('employer.vacancies.form.choose')}</option>
            {careTypeValues.map((c) => (
              <option key={c} value={c}>
                {t(`careTypes.${c}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="vf-roles" required>
            {t('employer.vacancies.form.roles')}
          </Label>
          <Input id="vf-roles" type="number" min={1} max={200} value={f.rolesCount} onChange={(e) => set('rolesCount', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="vf-country" required>
            {t('employer.vacancies.form.country')}
          </Label>
          <Select id="vf-country" value={f.country} onChange={(e) => set('country', e.target.value as CountryCode)}>
            <option value="">{t('employer.vacancies.form.choose')}</option>
            {countries.sorted.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="vf-city">{t('employer.vacancies.form.city')}</Label>
          <Input id="vf-city" value={f.city} maxLength={VACANCY_LIMITS.city} onChange={(e) => set('city', e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="vf-description" required>
            {t('employer.vacancies.form.description')}
          </Label>
          <Textarea id="vf-description" rows={5} value={f.description} maxLength={VACANCY_LIMITS.description} onChange={(e) => set('description', e.target.value)} />
          <p className="mt-1 text-xs text-ink/50">{t('employer.vacancies.form.descriptionHint')}</p>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-ink">{t('employer.vacancies.form.who')}</legend>
        <div>
          <Label htmlFor="vf-experience">{t('employer.vacancies.form.experience')}</Label>
          <Input id="vf-experience" type="number" min={0} max={30} value={f.minExperienceYears} onChange={(e) => set('minExperienceYears', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="vf-english">{t('employer.vacancies.form.english')}</Label>
          <Select id="vf-english" value={f.englishLevel} onChange={(e) => set('englishLevel', e.target.value as EnglishLevel)}>
            {englishLevelValues.map((l) => (
              <option key={l} value={l}>
                {t(`vacancies.english.${l}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="vf-requirements">{t('employer.vacancies.form.requirements')}</Label>
          <Textarea id="vf-requirements" rows={3} value={f.requirements} maxLength={VACANCY_LIMITS.requirements} onChange={(e) => set('requirements', e.target.value)} />
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-4">
        <legend className="mb-2 text-sm font-semibold text-ink">{t('employer.vacancies.form.terms')}</legend>
        <div>
          <Label htmlFor="vf-min">{t('employer.vacancies.form.salaryMin')}</Label>
          <Input id="vf-min" type="number" min={0} inputMode="decimal" value={f.salaryMin} onChange={(e) => set('salaryMin', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="vf-max">{t('employer.vacancies.form.salaryMax')}</Label>
          <Input id="vf-max" type="number" min={0} inputMode="decimal" value={f.salaryMax} onChange={(e) => set('salaryMax', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="vf-currency">{t('employer.vacancies.form.currency')}</Label>
          <Select id="vf-currency" value={f.salaryCurrency} onChange={(e) => set('salaryCurrency', e.target.value as CurrencyCode)}>
            {CURRENCY_CODES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="vf-period">{t('employer.vacancies.form.period')}</Label>
          <Select id="vf-period" value={f.salaryPeriod} onChange={(e) => set('salaryPeriod', e.target.value as SalaryPeriod)}>
            {salaryPeriodValues.map((p) => (
              <option key={p} value={p}>
                {t(`employer.vacancies.form.periods.${p}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="vf-contract">{t('employer.vacancies.form.contract')}</Label>
          <Input id="vf-contract" type="number" min={1} max={120} value={f.contractMonths} onChange={(e) => set('contractMonths', e.target.value)} />
        </div>
        <div>
          <Label htmlFor="vf-accommodation">{t('employer.vacancies.form.accommodation')}</Label>
          <Select id="vf-accommodation" value={f.accommodation} onChange={(e) => set('accommodation', e.target.value as FormState['accommodation'])}>
            <option value="">{t('employer.vacancies.form.notSaying')}</option>
            <option value="yes">{t('employer.vacancies.form.yes')}</option>
            <option value="no">{t('employer.vacancies.form.no')}</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="vf-visa">{t('international.form.visaSponsorship')}</Label>
          <Select id="vf-visa" value={f.visaSponsorship} onChange={(e) => set('visaSponsorship', e.target.value as VisaSponsorship)}>
            {visaSponsorshipValues.map((v) => (
              <option key={v} value={v}>
                {t(`international.visa.${v}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="vf-closes">{t('employer.vacancies.form.closes')}</Label>
          <Input id="vf-closes" type="date" value={f.closesOn} onChange={(e) => set('closesOn', e.target.value)} />
        </div>
        <div className="sm:col-span-4">
          <Label htmlFor="vf-start">{t('employer.vacancies.form.start')}</Label>
          <Input id="vf-start" value={f.startTimeframe} maxLength={100} onChange={(e) => set('startTimeframe', e.target.value)} placeholder={t('employer.vacancies.form.startPlaceholder')} />
        </div>
      </fieldset>

      <p className="rounded bg-paper px-3 py-2 text-xs text-ink/60">{t('employer.vacancies.form.reviewNote')}</p>
      {message && (
        <p role="alert" className="text-sm text-danger">
          {message}
        </p>
      )}
      <Button type="submit" disabled={pending}>
        {pending ? t('common.loading') : vacancy ? t('employer.vacancies.form.resubmit') : t('employer.vacancies.form.submit')}
      </Button>
    </form>
  );
}
