'use client';

import { useEffect, useState } from 'react';
import { Check } from 'lucide-react';
import { employerTypeValues, type EmployerAccountUpdate, type EmployerType } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useCountryNames } from '@/lib/countries';
import { ApiError } from '@/lib/api/client';
import { useEmployerAccount, useUpdateEmployerAccount } from '@/lib/hooks/use-international';
import { EmployerStatusBanner } from '@/components/international/employer-status';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';

/**
 * The organisation's details. Name, type and country are what staff verified,
 * so they lock once verified; a rejected account can correct them and goes
 * back for review.
 */
export default function EmployerAccountPage() {
  const { t } = useTranslation();
  const countries = useCountryNames();
  const { data: account } = useEmployerAccount();
  const save = useUpdateEmployerAccount();
  const [v, setV] = useState<EmployerAccountUpdate>({});
  const [saved, setSaved] = useState(false);
  useEffect(() => {
    if (account)
      setV({
        organisationName: account.organisationName,
        organisationType: account.organisationType,
        country: account.country,
        contactName: account.contactName,
        phone: account.phone ?? '',
        website: account.website ?? '',
        companyRegistrationNumber: account.companyRegistrationNumber ?? '',
      });
  }, [account]);
  if (!account) return <div className="h-40 animate-pulse rounded-lg bg-white" aria-hidden />;

  const locked = !account.canEditOrganisation;
  const set = (key: keyof EmployerAccountUpdate) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setSaved(false);
    setV((x) => ({ ...x, [key]: e.target.value }));
  };

  return (
    <div className="space-y-5">
      <h1 className="text-xl font-bold text-ink">{t('employer.account.title')}</h1>
      <EmployerStatusBanner account={account} />
      <form
        className="space-y-4 rounded-lg border border-border bg-white p-6"
        onSubmit={(e) => {
          e.preventDefault();
          const body: EmployerAccountUpdate = {
            contactName: v.contactName,
            phone: v.phone || null,
            website: v.website || null,
            companyRegistrationNumber: v.companyRegistrationNumber || null,
            ...(locked ? {} : { organisationName: v.organisationName, organisationType: v.organisationType as EmployerType, country: v.country }),
          };
          save.mutate(body, { onSuccess: () => setSaved(true) });
        }}
      >
        {locked && <p className="text-xs text-ink/50">{t('employer.account.locked')}</p>}
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="acc-org">{t('international.form.organisationName')}</Label>
            <Input id="acc-org" value={v.organisationName ?? ''} onChange={set('organisationName')} disabled={locked} maxLength={200} />
          </div>
          <div>
            <Label htmlFor="acc-type">{t('international.form.organisationType')}</Label>
            <Select id="acc-type" value={v.organisationType ?? ''} onChange={set('organisationType')} disabled={locked}>
              {employerTypeValues.map((type) => (
                <option key={type} value={type}>
                  {t(`international.employerTypes.${type}`)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="acc-country">{t('employer.register.country')}</Label>
            <Select id="acc-country" value={v.country ?? ''} onChange={set('country')} disabled={locked}>
              {countries.sorted.map((c) => (
                <option key={c.code} value={c.code}>
                  {c.name}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="acc-contact">{t('international.form.contactName')}</Label>
            <Input id="acc-contact" value={v.contactName ?? ''} onChange={set('contactName')} maxLength={150} />
          </div>
          <div>
            <Label htmlFor="acc-phone">{t('international.form.phone')}</Label>
            <Input id="acc-phone" value={v.phone ?? ''} onChange={set('phone')} maxLength={30} />
          </div>
          <div>
            <Label htmlFor="acc-website">{t('international.form.website')}</Label>
            <Input id="acc-website" value={v.website ?? ''} onChange={set('website')} maxLength={255} />
          </div>
          <div>
            <Label htmlFor="acc-regno">{t('employer.register.registrationNumber')}</Label>
            <Input id="acc-regno" value={v.companyRegistrationNumber ?? ''} onChange={set('companyRegistrationNumber')} maxLength={100} />
          </div>
        </div>
        <p className="text-xs text-ink/50">{t('employer.account.email', { email: account.email ?? '' })}</p>
        {save.isError && (
          <p role="alert" className="text-sm text-danger">
            {save.error instanceof ApiError ? save.error.message : t('portal.saveError')}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button type="submit" disabled={save.isPending}>
            {t('common.save')}
          </Button>
          {saved && (
            <span role="status" className="flex items-center gap-1 text-sm text-brand-dark">
              <Check className="h-4 w-4" aria-hidden />
              {t('portal.saved')}
            </span>
          )}
        </div>
      </form>
    </div>
  );
}
