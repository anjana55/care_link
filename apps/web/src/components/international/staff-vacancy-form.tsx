'use client';

import { useState } from 'react';
import {
  COUNTRY_CODES,
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
  type StaffVacancy,
  type VacancyInput,
  type VisaSponsorship,
} from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useSaveStaffVacancy } from '@/lib/hooks/use-international';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { countryName } from './shared';

/**
 * Staff post a vacancy for an enquiry they are working (it goes straight on
 * the board), or correct one an employer posted. Same fields as the
 * employer's form.
 */
export function StaffVacancyForm({
  enquiry,
  vacancy,
  onDone,
}: {
  enquiry?: { id: string; country: string; rolesCount: number; careSettings: string[]; visaSponsorship: VisaSponsorship; startTimeframe: string | null };
  vacancy?: StaffVacancy;
  onDone: () => void;
}) {
  const { t, locale } = useTranslation();
  const save = useSaveStaffVacancy();
  const [title, setTitle] = useState(vacancy?.title ?? '');
  const [country, setCountry] = useState<string>(vacancy?.country ?? enquiry?.country ?? '');
  const [city, setCity] = useState(vacancy?.city ?? '');
  const [careSetting, setCareSetting] = useState<string>(vacancy?.careSetting ?? enquiry?.careSettings[0] ?? '');
  const [rolesCount, setRolesCount] = useState(String(vacancy?.rolesCount ?? enquiry?.rolesCount ?? 1));
  const [description, setDescription] = useState(vacancy?.description ?? '');
  const [requirements, setRequirements] = useState(vacancy?.requirements ?? '');
  const [experience, setExperience] = useState(String(vacancy?.minExperienceYears ?? 1));
  const [english, setEnglish] = useState<EnglishLevel>(vacancy?.englishLevel ?? 'CONVERSATIONAL');
  const [salaryMin, setSalaryMin] = useState(vacancy?.salaryMin != null ? String(vacancy.salaryMin) : '');
  const [salaryMax, setSalaryMax] = useState(vacancy?.salaryMax != null ? String(vacancy.salaryMax) : '');
  const [currency, setCurrency] = useState<CurrencyCode>((vacancy?.salaryCurrency as CurrencyCode) ?? 'USD');
  const [period, setPeriod] = useState<SalaryPeriod>(vacancy?.salaryPeriod ?? 'MONTH');
  const [contract, setContract] = useState(vacancy?.contractMonths != null ? String(vacancy.contractMonths) : '');
  const [accommodation, setAccommodation] = useState(vacancy?.accommodationProvided == null ? '' : vacancy.accommodationProvided ? 'yes' : 'no');
  const [visa, setVisa] = useState<VisaSponsorship>(vacancy?.visaSponsorship ?? enquiry?.visaSponsorship ?? 'UNSURE');
  const [start, setStart] = useState(vacancy?.startTimeframe ?? enquiry?.startTimeframe ?? '');
  const [closesOn, setClosesOn] = useState(vacancy?.closesOn ?? '');
  const num = (s: string) => (s.trim() === '' ? null : Number(s));

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    const hasSalary = salaryMin.trim() !== '' || salaryMax.trim() !== '';
    const body: VacancyInput & { enquiryId?: string } = {
      ...(vacancy ? {} : { enquiryId: enquiry!.id }),
      title: title.trim(),
      country: country as CountryCode,
      city: city.trim() || null,
      careSetting: careSetting as CareType,
      rolesCount: Number(rolesCount),
      description: description.trim(),
      requirements: requirements.trim() || null,
      minExperienceYears: Number(experience) || 0,
      englishLevel: english,
      salaryMin: num(salaryMin),
      salaryMax: num(salaryMax),
      salaryCurrency: hasSalary ? currency : null,
      salaryPeriod: hasSalary ? period : null,
      contractMonths: num(contract),
      accommodationProvided: accommodation === '' ? null : accommodation === 'yes',
      visaSponsorship: visa,
      startTimeframe: start.trim() || null,
      closesOn: closesOn || null,
    };
    save.mutate({ id: vacancy?.id, body }, { onSuccess: onDone });
  };

  return (
    <form onSubmit={submit} className="space-y-4 rounded-lg border border-dashed border-brand/40 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="sv-title">{t('international.vacancies.form.title')}</Label>
          <Input id="sv-title" value={title} maxLength={VACANCY_LIMITS.title} onChange={(e) => setTitle(e.target.value)} required minLength={3} />
        </div>
        <div>
          <Label htmlFor="sv-setting">{t('international.vacancies.form.setting')}</Label>
          <Select id="sv-setting" value={careSetting} onChange={(e) => setCareSetting(e.target.value)} required>
            <option value="" />
            {careTypeValues.map((c) => (
              <option key={c} value={c}>
                {t(`careTypes.${c}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="sv-roles">{t('international.vacancies.form.roles')}</Label>
          <Input id="sv-roles" type="number" min={1} max={200} value={rolesCount} onChange={(e) => setRolesCount(e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="sv-country">{t('international.enquiries.country')}</Label>
          <Select id="sv-country" value={country} onChange={(e) => setCountry(e.target.value)} required>
            <option value="" />
            {COUNTRY_CODES.filter((c) => c !== 'LK').map((c) => (
              <option key={c} value={c}>
                {countryName(c, locale)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="sv-city">{t('international.vacancies.form.city')}</Label>
          <Input id="sv-city" value={city} maxLength={VACANCY_LIMITS.city} onChange={(e) => setCity(e.target.value)} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="sv-description">{t('international.vacancies.form.description')}</Label>
          <Textarea id="sv-description" rows={4} value={description} maxLength={VACANCY_LIMITS.description} onChange={(e) => setDescription(e.target.value)} required minLength={20} />
        </div>
        <div>
          <Label htmlFor="sv-experience">{t('international.vacancies.form.experience')}</Label>
          <Input id="sv-experience" type="number" min={0} max={30} value={experience} onChange={(e) => setExperience(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="sv-english">{t('international.vacancies.form.english')}</Label>
          <Select id="sv-english" value={english} onChange={(e) => setEnglish(e.target.value as EnglishLevel)}>
            {englishLevelValues.map((l) => (
              <option key={l} value={l}>
                {t(`international.vacancies.english.${l}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="sv-requirements">{t('international.vacancies.form.requirements')}</Label>
          <Textarea id="sv-requirements" rows={2} value={requirements} maxLength={VACANCY_LIMITS.requirements} onChange={(e) => setRequirements(e.target.value)} />
        </div>
      </div>
      <div className="grid gap-3 sm:grid-cols-4">
        <div>
          <Label htmlFor="sv-min">{t('international.vacancies.form.salaryMin')}</Label>
          <Input id="sv-min" type="number" min={0} value={salaryMin} onChange={(e) => setSalaryMin(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="sv-max">{t('international.vacancies.form.salaryMax')}</Label>
          <Input id="sv-max" type="number" min={0} value={salaryMax} onChange={(e) => setSalaryMax(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="sv-currency">{t('international.detail.currency')}</Label>
          <Select id="sv-currency" value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}>
            {CURRENCY_CODES.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="sv-period">{t('international.vacancies.form.period')}</Label>
          <Select id="sv-period" value={period} onChange={(e) => setPeriod(e.target.value as SalaryPeriod)}>
            {salaryPeriodValues.map((p) => (
              <option key={p} value={p}>
                {t(`international.vacancies.periods.${p}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="sv-contract">{t('international.vacancies.form.contract')}</Label>
          <Input id="sv-contract" type="number" min={1} max={120} value={contract} onChange={(e) => setContract(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="sv-accommodation">{t('international.vacancies.form.accommodation')}</Label>
          <Select id="sv-accommodation" value={accommodation} onChange={(e) => setAccommodation(e.target.value)}>
            <option value="">-</option>
            <option value="yes">{t('international.vacancies.form.yes')}</option>
            <option value="no">{t('international.vacancies.form.no')}</option>
          </Select>
        </div>
        <div>
          <Label htmlFor="sv-visa">{t('international.detail.visa')}</Label>
          <Select id="sv-visa" value={visa} onChange={(e) => setVisa(e.target.value as VisaSponsorship)}>
            {visaSponsorshipValues.map((v) => (
              <option key={v} value={v}>
                {t(`international.visa.${v}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="sv-closes">{t('international.vacancies.form.closes')}</Label>
          <Input id="sv-closes" type="date" value={closesOn} onChange={(e) => setClosesOn(e.target.value)} />
        </div>
        <div className="sm:col-span-4">
          <Label htmlFor="sv-start">{t('international.detail.start')}</Label>
          <Input id="sv-start" value={start} maxLength={100} onChange={(e) => setStart(e.target.value)} />
        </div>
      </div>
      {save.isError && <p className="text-sm text-danger">{save.error instanceof Error ? save.error.message : t('common.actionFailed')}</p>}
      <div className="flex gap-2">
        <Button type="submit" size="sm" disabled={save.isPending}>
          {vacancy ? t('common.save') : t('international.vacancies.form.publish')}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={onDone}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
