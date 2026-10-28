'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  COUNTRY_CODES,
  careTypeValues,
  employerTypeValues,
  visaSponsorshipValues,
  type CareType,
  type CountryCode,
  type EmployerType,
  type VisaSponsorship,
} from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useEmployerAccounts } from '@/lib/hooks/use-international';
import { useCreateEnquiry } from '@/lib/hooks/use-overseas-admin';
import { Button } from '@/components/ui/button';
import { Input, Label, RequiredLegend, Select, Textarea } from '@/components/ui/input';
import { countryName } from '@/components/international/shared';

/**
 * Admins only: record an enquiry that came in by phone, email or in person.
 * It starts In progress (whoever records it is already handling it) and opens
 * on its own page once saved.
 */
export function NewEnquiryForm({ onCancel }: { onCancel: () => void }) {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const create = useCreateEnquiry();
  const { data: accounts = [] } = useEmployerAccounts('all');
  const [v, setV] = useState({
    organisationName: '',
    organisationType: 'RECRUITMENT_AGENCY' as EmployerType,
    country: '' as CountryCode | '',
    contactName: '',
    email: '',
    phone: '',
    website: '',
    rolesCount: '1',
    careSettings: [] as CareType[],
    languages: '',
    startTimeframe: '',
    visaSponsorship: 'UNSURE' as VisaSponsorship,
    message: '',
    staffNote: '',
    employerId: '',
  });
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((x) => ({ ...x, [k]: value }));
  const countries = useMemo(() => COUNTRY_CODES.map((c) => ({ code: c, name: countryName(c, locale) })).sort((a, b) => a.name.localeCompare(b.name)), [locale]);
  const ready = v.organisationName.trim().length >= 2 && v.contactName.trim().length >= 2 && v.email.trim() && v.country && v.careSettings.length > 0 && Number(v.rolesCount) >= 1;
  const opt = (s: string) => s.trim() || undefined;

  return (
    <form
      className="mb-6 space-y-5 rounded-lg border border-brand/40 bg-white p-5"
      onSubmit={(e) => {
        e.preventDefault();
        if (!ready || !v.country) return;
        create.mutate(
          {
            organisationName: v.organisationName.trim(),
            organisationType: v.organisationType,
            country: v.country,
            contactName: v.contactName.trim(),
            email: v.email.trim(),
            phone: opt(v.phone),
            website: opt(v.website),
            rolesCount: Number(v.rolesCount),
            careSettings: v.careSettings,
            languages: opt(v.languages),
            startTimeframe: opt(v.startTimeframe),
            visaSponsorship: v.visaSponsorship,
            message: opt(v.message),
            staffNote: v.staffNote.trim() || null,
            employerId: v.employerId || null,
          },
          { onSuccess: (enquiry) => router.push(`/international/${enquiry.id}`) },
        );
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-semibold text-ink">{t('overseasAdmin.newEnquiry.title')}</h2>
        <RequiredLegend label={t('common.requiredField')} />
      </div>
      <p className="text-sm text-ink/60">{t('overseasAdmin.newEnquiry.hint')}</p>
      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-ink">{t('international.detail.employer')}</legend>
        <div>
          <Label htmlFor="ne-org" required>{t('international.edit.organisation')}</Label>
          <Input id="ne-org" value={v.organisationName} onChange={(e) => set('organisationName', e.target.value)} maxLength={200} required />
        </div>
        <div>
          <Label htmlFor="ne-type" required>{t('international.detail.type')}</Label>
          <Select id="ne-type" value={v.organisationType} onChange={(e) => set('organisationType', e.target.value as EmployerType)}>
            {employerTypeValues.map((k) => (
              <option key={k} value={k}>
                {t(`international.employerTypes.${k}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ne-country" required>{t('international.enquiries.country')}</Label>
          <Select id="ne-country" value={v.country} onChange={(e) => set('country', e.target.value as CountryCode)} required>
            <option value="">{t('overseasAdmin.chooseCountry')}</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="ne-contact" required>{t('international.detail.contact')}</Label>
          <Input id="ne-contact" value={v.contactName} onChange={(e) => set('contactName', e.target.value)} maxLength={150} required />
        </div>
        <div>
          <Label htmlFor="ne-email" required>{t('international.detail.email')}</Label>
          <Input id="ne-email" type="email" value={v.email} onChange={(e) => set('email', e.target.value)} maxLength={255} required />
        </div>
        <div>
          <Label htmlFor="ne-phone">{t('international.detail.phone')}</Label>
          <Input id="ne-phone" type="tel" value={v.phone} onChange={(e) => set('phone', e.target.value)} maxLength={30} placeholder="+81 90 1234 5678" />
        </div>
        <div>
          <Label htmlFor="ne-web">{t('international.detail.website')}</Label>
          <Input id="ne-web" value={v.website} onChange={(e) => set('website', e.target.value)} maxLength={255} />
        </div>
        <div>
          <Label htmlFor="ne-account">{t('international.detail.account')}</Label>
          <Select id="ne-account" value={v.employerId} onChange={(e) => set('employerId', e.target.value)}>
            <option value="">{t('international.edit.noAccount')}</option>
            {accounts.map((a) => (
              <option key={a.id} value={a.id}>
                {a.organisationName} · {a.email ?? '-'}
              </option>
            ))}
          </Select>
        </div>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="mb-2 text-sm font-semibold text-ink">{t('international.detail.needs')}</legend>
        <div>
          <Label htmlFor="ne-roles" required>{t('international.enquiries.roles')}</Label>
          <Input id="ne-roles" type="number" min={1} max={500} value={v.rolesCount} onChange={(e) => set('rolesCount', e.target.value)} required />
        </div>
        <div>
          <Label htmlFor="ne-visa" required>{t('international.detail.visa')}</Label>
          <Select id="ne-visa" value={v.visaSponsorship} onChange={(e) => set('visaSponsorship', e.target.value as VisaSponsorship)}>
            {visaSponsorshipValues.map((k) => (
              <option key={k} value={k}>
                {t(`international.visa.${k}`)}
              </option>
            ))}
          </Select>
        </div>
        <div className="sm:col-span-2">
          <span className="mb-1 block text-sm font-medium text-ink">
            {t('international.detail.settings')}
            <span aria-hidden className="ml-0.5 text-danger">
              *
            </span>
          </span>
          <div className="flex flex-wrap gap-x-4 gap-y-2">
            {careTypeValues.map((c) => (
              <label key={c} className="flex items-center gap-2 text-sm text-ink">
                <input type="checkbox" checked={v.careSettings.includes(c)} onChange={(e) => set('careSettings', e.target.checked ? [...v.careSettings, c] : v.careSettings.filter((x) => x !== c))} />
                {t(`careTypes.${c}`)}
              </label>
            ))}
          </div>
        </div>
        <div>
          <Label htmlFor="ne-langs">{t('international.detail.languages')}</Label>
          <Input id="ne-langs" value={v.languages} onChange={(e) => set('languages', e.target.value)} maxLength={255} />
        </div>
        <div>
          <Label htmlFor="ne-start">{t('international.detail.start')}</Label>
          <Input id="ne-start" value={v.startTimeframe} onChange={(e) => set('startTimeframe', e.target.value)} maxLength={100} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="ne-msg">{t('overseasAdmin.newEnquiry.message')}</Label>
          <Textarea id="ne-msg" rows={3} value={v.message} onChange={(e) => set('message', e.target.value)} maxLength={3000} />
        </div>
        <div className="sm:col-span-2">
          <Label htmlFor="ne-note">{t('international.detail.note')}</Label>
          <Textarea id="ne-note" rows={2} value={v.staffNote} onChange={(e) => set('staffNote', e.target.value)} maxLength={5000} />
        </div>
      </fieldset>

      {create.isError && <p className="text-sm text-danger">{create.error instanceof Error ? create.error.message : t('common.actionFailed')}</p>}
      <div className="flex gap-3">
        <Button type="submit" disabled={!ready || create.isPending}>
          {t('overseasAdmin.newEnquiry.save')}
        </Button>
        <Button type="button" variant="ghost" onClick={onCancel}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
