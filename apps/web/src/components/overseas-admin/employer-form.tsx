'use client';

import { useMemo, useState } from 'react';
import { COUNTRY_CODES, employerTypeValues, type CountryCode, type EmployerAdminRow, type EmployerType } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useCreateEmployer, useEditEmployer, type EmployerInput } from '@/lib/hooks/use-overseas-admin';
import { Button } from '@/components/ui/button';
import { Input, Label, RequiredLegend, Select } from '@/components/ui/input';
import { countryName } from '@/components/international/shared';

/**
 * Admins only. Without `employer`: open an account for an organisation (no
 * password - by default the contact is emailed a link to set one). With it:
 * correct any detail, including the sign-in email. Only changed fields are sent.
 */
export function EmployerForm({ employer, onDone }: { employer?: EmployerAdminRow; onDone: (message?: string) => void }) {
  const { t, locale } = useTranslation();
  const create = useCreateEmployer();
  const edit = useEditEmployer();
  const initial = useMemo(
    () => ({
      organisationName: employer?.organisationName ?? '',
      organisationType: (employer?.organisationType ?? 'RECRUITMENT_AGENCY') as EmployerType,
      country: (employer?.country ?? '') as CountryCode | '',
      contactName: employer?.contactName ?? '',
      email: employer?.email ?? '',
      phone: employer?.phone ?? '',
      website: employer?.website ?? '',
      companyRegistrationNumber: employer?.companyRegistrationNumber ?? '',
    }),
    [employer],
  );
  const [v, setV] = useState(initial);
  const [sendLink, setSendLink] = useState(true);
  const [status, setStatus] = useState<'VERIFIED' | 'PENDING_REVIEW'>('VERIFIED');
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((x) => ({ ...x, [k]: value }));
  const countries = useMemo(() => COUNTRY_CODES.map((c) => ({ code: c, name: countryName(c, locale) })).sort((a, b) => a.name.localeCompare(b.name)), [locale]);
  const pending = create.isPending || edit.isPending;
  const error = create.error ?? edit.error;
  const ready = v.organisationName.trim().length >= 2 && v.contactName.trim().length >= 2 && v.email.trim() && v.country;

  const changes = (): EmployerInput => {
    const out: EmployerInput = {};
    if (v.organisationName.trim() !== initial.organisationName) out.organisationName = v.organisationName.trim();
    if (v.organisationType !== initial.organisationType) out.organisationType = v.organisationType;
    if (v.country !== initial.country && v.country) out.country = v.country;
    if (v.contactName.trim() !== initial.contactName) out.contactName = v.contactName.trim();
    if (v.email.trim().toLowerCase() !== (initial.email ?? '').toLowerCase()) out.email = v.email.trim();
    for (const k of ['phone', 'website', 'companyRegistrationNumber'] as const) if (v[k].trim() !== initial[k]) out[k] = v[k].trim() || null;
    return out;
  };

  const submit = () => {
    if (!ready || !v.country) return;
    if (employer) {
      const body = changes();
      if (!Object.keys(body).length) return onDone();
      edit.mutate({ id: employer.id, ...body }, { onSuccess: () => onDone(t('overseasAdmin.employer.saved')) });
    } else {
      create.mutate(
        {
          organisationName: v.organisationName.trim(),
          organisationType: v.organisationType,
          country: v.country,
          contactName: v.contactName.trim(),
          email: v.email.trim(),
          phone: v.phone.trim() || null,
          website: v.website.trim() || null,
          companyRegistrationNumber: v.companyRegistrationNumber.trim() || null,
          sendPasswordLink: sendLink,
          status,
        },
        { onSuccess: (res) => onDone(res.passwordLinkSent ? t('overseasAdmin.employer.createdLinkSent', { email: res.email ?? '' }) : t('overseasAdmin.employer.created')) },
      );
    }
  };

  return (
    <form
      className="space-y-4 rounded-lg border border-brand/40 bg-white p-5"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold text-ink">{employer ? t('overseasAdmin.employer.editTitle') : t('overseasAdmin.employer.addTitle')}</h3>
        <RequiredLegend label={t('common.requiredField')} />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="em-org" required>{t('international.edit.organisation')}</Label>
          <Input id="em-org" value={v.organisationName} onChange={(e) => set('organisationName', e.target.value)} maxLength={200} required />
        </div>
        <div>
          <Label htmlFor="em-type" required>{t('international.detail.type')}</Label>
          <Select id="em-type" value={v.organisationType} onChange={(e) => set('organisationType', e.target.value as EmployerType)}>
            {employerTypeValues.map((k) => (
              <option key={k} value={k}>
                {t(`international.employerTypes.${k}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="em-country" required>{t('international.enquiries.country')}</Label>
          <Select id="em-country" value={v.country} onChange={(e) => set('country', e.target.value as CountryCode)} required>
            <option value="">{t('overseasAdmin.chooseCountry')}</option>
            {countries.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="em-contact" required>{t('international.detail.contact')}</Label>
          <Input id="em-contact" value={v.contactName} onChange={(e) => set('contactName', e.target.value)} maxLength={150} required />
        </div>
        <div>
          <Label htmlFor="em-email" required>{t('overseasAdmin.employer.signInEmail')}</Label>
          <Input id="em-email" type="email" value={v.email} onChange={(e) => set('email', e.target.value)} maxLength={255} required />
          {employer && <p className="mt-1 text-xs text-ink/50">{t('overseasAdmin.employer.emailHint')}</p>}
        </div>
        <div>
          <Label htmlFor="em-phone">{t('international.detail.phone')}</Label>
          <Input id="em-phone" type="tel" value={v.phone} onChange={(e) => set('phone', e.target.value)} maxLength={30} placeholder="+81 90 1234 5678" />
        </div>
        <div>
          <Label htmlFor="em-web">{t('international.detail.website')}</Label>
          <Input id="em-web" value={v.website} onChange={(e) => set('website', e.target.value)} maxLength={255} />
        </div>
        <div>
          <Label htmlFor="em-reg">{t('international.employers.registration')}</Label>
          <Input id="em-reg" value={v.companyRegistrationNumber} onChange={(e) => set('companyRegistrationNumber', e.target.value)} maxLength={100} />
        </div>
        {!employer && (
          <>
            <div>
              <Label htmlFor="em-status">{t('overseasAdmin.employer.startAs')}</Label>
              <Select id="em-status" value={status} onChange={(e) => setStatus(e.target.value as 'VERIFIED' | 'PENDING_REVIEW')}>
                <option value="VERIFIED">{t('international.employers.status.VERIFIED')}</option>
                <option value="PENDING_REVIEW">{t('international.employers.status.PENDING_REVIEW')}</option>
              </Select>
            </div>
            <label className="flex items-start gap-2 self-end text-sm text-ink">
              <input type="checkbox" className="mt-1" checked={sendLink} onChange={(e) => setSendLink(e.target.checked)} />
              <span>
                {t('overseasAdmin.employer.sendLink')}
                <span className="block text-xs text-ink/50">{t('overseasAdmin.employer.sendLinkHint')}</span>
              </span>
            </label>
          </>
        )}
      </div>
      {error && <p className="text-sm text-danger">{error instanceof Error ? error.message : t('common.actionFailed')}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={!ready || pending}>
          {employer ? t('common.save') : t('overseasAdmin.employer.create')}
        </Button>
        <Button type="button" variant="ghost" onClick={() => onDone()}>
          {t('common.cancel')}
        </Button>
      </div>
    </form>
  );
}
