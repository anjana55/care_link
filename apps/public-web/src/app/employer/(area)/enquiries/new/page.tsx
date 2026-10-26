'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { careTypeValues, visaSponsorshipValues, type CareType, type CountryCode, type VisaSponsorship } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useCountryNames } from '@/lib/countries';
import { ApiError } from '@/lib/api/client';
import { useCreateEmployerEnquiry, useEmployerAccount, useTalentProfile } from '@/lib/hooks/use-international';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** A signed-in employer's enquiry: the organisation and contact details come from their account. */
export default function NewEmployerEnquiryPage() {
  const { t, locale } = useTranslation();
  const countries = useCountryNames();
  const { data: account } = useEmployerAccount();
  const create = useCreateEmployerEnquiry();
  const [talentSlug, setTalentSlug] = useState<string | null>(null);
  useEffect(() => setTalentSlug(new URLSearchParams(window.location.search).get('talent')), []);
  const { data: talent } = useTalentProfile(talentSlug, locale);

  const [country, setCountry] = useState<CountryCode | ''>('');
  const [rolesCount, setRolesCount] = useState('1');
  const [careSettings, setCareSettings] = useState<CareType[]>([]);
  const [languages, setLanguages] = useState('');
  const [startTimeframe, setStartTimeframe] = useState('');
  const [visaSponsorship, setVisaSponsorship] = useState<VisaSponsorship>('UNSURE');
  const [message, setMessage] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [reference, setReference] = useState<string | null>(null);

  if (reference) {
    return (
      <div role="status" className="rounded-lg border border-brand/30 bg-white p-8 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-brand" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold text-ink">{t('international.form.sentTitle')}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink/70">{t('employer.newEnquiry.sentBody', { reference })}</p>
        <Link href="/employer" className="mt-4 inline-block text-sm font-semibold text-brand hover:text-brand-dark">
          {t('employer.nav.overview')}
        </Link>
      </div>
    );
  }

  return (
    <form
      noValidate
      className="space-y-5 rounded-lg border border-border bg-white p-6"
      onSubmit={(e) => {
        e.preventDefault();
        setError(null);
        const roles = Number(rolesCount);
        if (!careSettings.length) return setError(t('international.form.chooseSetting'));
        if (!Number.isInteger(roles) || roles < 1 || roles > 500) return setError(t('international.form.invalidRoles'));
        create.mutate(
          {
            ...(country ? { country } : {}),
            rolesCount: roles,
            careSettings,
            languages: languages.trim() || undefined,
            startTimeframe: startTimeframe.trim() || undefined,
            visaSponsorship,
            message: message.trim() || undefined,
            talentSlug: talent?.slug,
          },
          {
            onSuccess: (r) => setReference(r.reference),
            onError: (err) => setError(err instanceof ApiError ? err.message : t('international.form.failed')),
          },
        );
      }}
    >
      <div>
        <h1 className="text-xl font-bold text-ink">{t('employer.newEnquiry.title')}</h1>
        <p className="mt-1 text-sm text-ink/60">{t('employer.newEnquiry.intro', { organisation: account?.organisationName ?? '' })}</p>
      </div>
      {talent && <p className="rounded-DEFAULT border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-ink">{t('international.form.aboutTalent', { name: talent.firstName })}</p>}

      <fieldset>
        <legend className="mb-2 text-xs font-medium text-ink/60">
          {t('international.form.careSettings')} <span aria-hidden className="text-danger">*</span>
        </legend>
        <div className="flex flex-wrap gap-2">
          {careTypeValues.map((type) => {
            const on = careSettings.includes(type);
            return (
              <button
                key={type}
                type="button"
                aria-pressed={on}
                onClick={() => setCareSettings((list) => (on ? list.filter((x) => x !== type) : [...list, type]))}
                className={cn('rounded-full border px-3 py-1.5 text-sm transition-colors', on ? 'border-brand bg-brand text-white' : 'border-border bg-white text-ink hover:border-brand')}
              >
                {t(`careTypes.${type}`)}
              </button>
            );
          })}
        </div>
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="ne-country">{t('international.form.country')}</Label>
          <Select id="ne-country" value={country} onChange={(e) => setCountry(e.target.value as CountryCode)}>
            <option value="">{account ? t('employer.newEnquiry.sameCountry', { country: countries.name(account.country) }) : '—'}</option>
            {countries.sorted.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ne-roles" required>
            {t('international.form.rolesCount')}
          </Label>
          <Input id="ne-roles" type="number" min={1} max={500} value={rolesCount} onChange={(e) => setRolesCount(e.target.value)} />
        </div>
        <div>
          <Label htmlFor="ne-start">{t('international.form.startTimeframe')}</Label>
          <Input id="ne-start" value={startTimeframe} onChange={(e) => setStartTimeframe(e.target.value)} placeholder={t('international.form.startPlaceholder')} maxLength={100} />
        </div>
        <div>
          <Label htmlFor="ne-visa">{t('international.form.visaSponsorship')}</Label>
          <Select id="ne-visa" value={visaSponsorship} onChange={(e) => setVisaSponsorship(e.target.value as VisaSponsorship)}>
            {visaSponsorshipValues.map((v) => (
              <option key={v} value={v}>
                {t(`international.visa.${v}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>
      <div>
        <Label htmlFor="ne-languages">{t('international.form.languages')}</Label>
        <Input id="ne-languages" value={languages} onChange={(e) => setLanguages(e.target.value)} placeholder={t('international.form.languagesPlaceholder')} maxLength={255} />
      </div>
      <div>
        <Label htmlFor="ne-message">{t('international.form.message')}</Label>
        <Textarea id="ne-message" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('international.form.messagePlaceholder')} maxLength={3000} />
      </div>
      {error && (
        <p role="alert" className="text-sm text-danger">
          {error}
        </p>
      )}
      <Button type="submit" size="lg" disabled={create.isPending}>
        {create.isPending ? t('international.form.sending') : t('international.form.submit')}
      </Button>
    </form>
  );
}
