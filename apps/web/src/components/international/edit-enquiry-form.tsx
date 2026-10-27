'use client';

import { useMemo, useState } from 'react';
import {
  COUNTRY_CODES,
  careTypeValues,
  employerTypeValues,
  visaSponsorshipValues,
  type CareType,
  type CountryCode,
  type EmployerEnquiry,
  type EmployerType,
  type EnquiryDetailsInput,
  type VisaSponsorship,
} from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useEditEnquiryDetails, useEmployerAccounts } from '@/lib/hooks/use-international';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { countryName } from './shared';

/**
 * Admins only: correct what the employer sent - a misspelt name, the wrong
 * email or phone, the number of roles - or link the enquiry to the employer's
 * account (an enquiry sent before they signed up, from another address).
 * Only changed fields are sent; every edit is in the audit log.
 */
export function EditEnquiryForm({ enquiry, onDone }: { enquiry: EmployerEnquiry; onDone: () => void }) {
  const { t, locale } = useTranslation();
  const edit = useEditEnquiryDetails(enquiry.id);
  const { data: accounts = [] } = useEmployerAccounts('all');
  const initial = useMemo(
    () => ({
      organisationName: enquiry.organisationName,
      organisationType: enquiry.organisationType,
      country: enquiry.country as CountryCode,
      contactName: enquiry.contactName,
      email: enquiry.email,
      phone: enquiry.phone ?? '',
      website: enquiry.website ?? '',
      rolesCount: String(enquiry.rolesCount),
      careSettings: enquiry.careSettings as CareType[],
      languages: enquiry.languages ?? '',
      startTimeframe: enquiry.startTimeframe ?? '',
      visaSponsorship: enquiry.visaSponsorship,
      message: enquiry.message ?? '',
      employerId: enquiry.employer?.id ?? '',
    }),
    [enquiry],
  );
  const [v, setV] = useState(initial);
  const set = <K extends keyof typeof v>(k: K, value: (typeof v)[K]) => setV((x) => ({ ...x, [k]: value }));
  const countries = useMemo(
    () =>
      COUNTRY_CODES.map((c) => ({
        code: c,
        name: countryName(c, locale),
      })).sort((a, b) => a.name.localeCompare(b.name)),
    [locale],
  );
  // Accounts with the enquiry's email first: almost always the one to link.
  const sortedAccounts = useMemo(
    () =>
      [...accounts].sort(
        (a, b) =>
          Number(b.email?.toLowerCase() === v.email.toLowerCase()) - Number(a.email?.toLowerCase() === v.email.toLowerCase()) ||
          a.organisationName.localeCompare(b.organisationName),
      ),
    [accounts, v.email],
  );

  /** Only what changed: the rest is left exactly as the employer sent it. */
  const changes = (): EnquiryDetailsInput => {
    const out: EnquiryDetailsInput = {};
    const text = (k: 'organisationName' | 'contactName' | 'email') => v[k].trim() !== initial[k] && (out[k] = v[k].trim());
    const optional = (k: 'phone' | 'website' | 'languages' | 'startTimeframe' | 'message') => v[k].trim() !== initial[k] && (out[k] = v[k].trim() || null);
    text('organisationName');
    text('contactName');
    text('email');
    optional('phone');
    optional('website');
    optional('languages');
    optional('startTimeframe');
    optional('message');
    if (v.organisationType !== initial.organisationType) out.organisationType = v.organisationType;
    if (v.country !== initial.country) out.country = v.country;
    if (v.visaSponsorship !== initial.visaSponsorship) out.visaSponsorship = v.visaSponsorship;
    if (Number(v.rolesCount) !== enquiry.rolesCount) out.rolesCount = Number(v.rolesCount);
    if ([...v.careSettings].sort().join() !== [...initial.careSettings].sort().join()) out.careSettings = v.careSettings;
    if (v.employerId !== initial.employerId) out.employerId = v.employerId || null;
    return out;
  };
  const pending = changes();
  const dirty = Object.keys(pending).length > 0;

  return (
    <Card className="border-brand/40">
      <CardHeader>
        <CardTitle>{t('international.edit.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-5"
          onSubmit={(e) => {
            e.preventDefault();
            if (dirty) edit.mutate(pending, { onSuccess: onDone });
          }}
        >
          <p className="text-sm text-ink/60">{t('international.edit.hint')}</p>
          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-ink">{t('international.detail.employer')}</legend>
            <div>
              <Label htmlFor="ed-org">{t('international.edit.organisation')}</Label>
              <Input id="ed-org" value={v.organisationName} onChange={(e) => set('organisationName', e.target.value)} maxLength={200} required minLength={2} />
            </div>
            <div>
              <Label htmlFor="ed-type">{t('international.detail.type')}</Label>
              <Select id="ed-type" value={v.organisationType} onChange={(e) => set('organisationType', e.target.value as EmployerType)}>
                {employerTypeValues.map((k) => (
                  <option key={k} value={k}>
                    {t(`international.employerTypes.${k}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="ed-country">{t('international.enquiries.country')}</Label>
              <Select id="ed-country" value={v.country} onChange={(e) => set('country', e.target.value as CountryCode)}>
                {countries.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="ed-contact">{t('international.detail.contact')}</Label>
              <Input id="ed-contact" value={v.contactName} onChange={(e) => set('contactName', e.target.value)} maxLength={150} required minLength={2} />
            </div>
            <div>
              <Label htmlFor="ed-email">{t('international.detail.email')}</Label>
              <Input id="ed-email" type="email" value={v.email} onChange={(e) => set('email', e.target.value)} maxLength={255} required />
              <p className="mt-1 text-xs text-ink/50">{t('international.edit.emailHint')}</p>
            </div>
            <div>
              <Label htmlFor="ed-phone">{t('international.detail.phone')}</Label>
              <Input id="ed-phone" type="tel" value={v.phone} onChange={(e) => set('phone', e.target.value)} maxLength={30} placeholder="+81 90 1234 5678" />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="ed-web">{t('international.detail.website')}</Label>
              <Input id="ed-web" value={v.website} onChange={(e) => set('website', e.target.value)} maxLength={255} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="ed-account">{t('international.detail.account')}</Label>
              <Select id="ed-account" value={v.employerId} onChange={(e) => set('employerId', e.target.value)}>
                <option value="">{t('international.edit.noAccount')}</option>
                {sortedAccounts.map((a) => (
                  <option key={a.id} value={a.id}>
                    {a.organisationName} · {a.email ?? '-'} · {t(`international.employers.status.${a.status}`)}
                    {a.email?.toLowerCase() === v.email.toLowerCase() ? ` · ${t('international.edit.sameEmail')}` : ''}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-ink/50">{t('international.edit.accountHint')}</p>
            </div>
          </fieldset>

          <fieldset className="grid gap-4 sm:grid-cols-2">
            <legend className="mb-2 text-sm font-semibold text-ink">{t('international.detail.needs')}</legend>
            <div>
              <Label htmlFor="ed-roles">{t('international.enquiries.roles')}</Label>
              <Input id="ed-roles" type="number" min={1} max={500} value={v.rolesCount} onChange={(e) => set('rolesCount', e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="ed-visa">{t('international.detail.visa')}</Label>
              <Select id="ed-visa" value={v.visaSponsorship} onChange={(e) => set('visaSponsorship', e.target.value as VisaSponsorship)}>
                {visaSponsorshipValues.map((k) => (
                  <option key={k} value={k}>
                    {t(`international.visa.${k}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="sm:col-span-2">
              <span className="mb-1 block text-xs font-medium text-ink/70">{t('international.detail.settings')}</span>
              <div className="flex flex-wrap gap-x-4 gap-y-2">
                {careTypeValues.map((c) => (
                  <label key={c} className="flex items-center gap-2 text-sm text-ink">
                    <input
                      type="checkbox"
                      checked={v.careSettings.includes(c)}
                      onChange={(e) => set('careSettings', e.target.checked ? [...v.careSettings, c] : v.careSettings.filter((x: CareType) => x !== c))}
                    />
                    {t(`careTypes.${c}`)}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <Label htmlFor="ed-langs">{t('international.detail.languages')}</Label>
              <Input id="ed-langs" value={v.languages} onChange={(e) => set('languages', e.target.value)} maxLength={255} />
            </div>
            <div>
              <Label htmlFor="ed-start">{t('international.detail.start')}</Label>
              <Input id="ed-start" value={v.startTimeframe} onChange={(e) => set('startTimeframe', e.target.value)} maxLength={100} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="ed-msg">{t('international.edit.message')}</Label>
              <Textarea id="ed-msg" rows={4} value={v.message} onChange={(e) => set('message', e.target.value)} maxLength={3000} />
            </div>
          </fieldset>

          {edit.isError && <p className="text-sm text-danger">{edit.error instanceof Error ? edit.error.message : t('common.actionFailed')}</p>}
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={!dirty || v.careSettings.length === 0 || edit.isPending}>
              {t('common.save')}
            </Button>
            <Button type="button" variant="ghost" onClick={onDone}>
              {t('common.cancel')}
            </Button>
            {dirty && (
              <span className="text-xs text-ink/50">
                {t('international.edit.changed', {
                  n: Object.keys(pending).length,
                })}
              </span>
            )}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}
