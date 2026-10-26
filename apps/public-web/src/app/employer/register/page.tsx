'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, ShieldCheck } from 'lucide-react';
import { employerTypeValues, type CountryCode, type EmployerType } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useCountryNames } from '@/lib/countries';
import { employerApi } from '@/lib/api/international';
import { ApiError } from '@/lib/api/client';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { Input, Label, Select } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { Button } from '@/components/ui/button';

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9 ()-]{6,30}$/;

/**
 * An overseas employer creating an account. After confirming their email
 * they can follow enquiries and keep a shortlist straight away; asking for
 * interviews waits until staff have verified the organisation.
 */
export default function EmployerRegisterPage() {
  const { t } = useTranslation();
  const countries = useCountryNames();
  const [v, setV] = useState({
    organisationName: '',
    organisationType: '' as EmployerType | '',
    country: '' as CountryCode | '',
    contactName: '',
    email: '',
    password: '',
    phone: '',
    website: '',
    companyRegistrationNumber: '',
  });
  const [consent, setConsent] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, setPending] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const set = (key: keyof typeof v) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setV((x) => ({ ...x, [key]: e.target.value }));

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const e: Record<string, string> = {};
    if (v.organisationName.trim().length < 2) e.organisationName = t('international.form.required');
    if (!v.organisationType) e.organisationType = t('international.form.required');
    if (!v.country) e.country = t('international.form.required');
    if (v.contactName.trim().length < 2) e.contactName = t('international.form.required');
    if (!EMAIL.test(v.email.trim())) e.email = t('international.form.invalidEmail');
    if (v.password.length < 8) e.password = t('employer.register.passwordShort');
    if (v.phone.trim() && !PHONE.test(v.phone.trim())) e.phone = t('international.form.invalidPhone');
    if (!consent) e.consent = t('employer.register.consentRequired');
    setErrors(e);
    if (Object.keys(e).length) return;
    setPending(true);
    setServerError(null);
    try {
      await employerApi.register({
        organisationName: v.organisationName.trim(),
        organisationType: v.organisationType as EmployerType,
        country: v.country as CountryCode,
        contactName: v.contactName.trim(),
        email: v.email.trim(),
        password: v.password,
        phone: v.phone.trim() || undefined,
        website: v.website.trim() || undefined,
        companyRegistrationNumber: v.companyRegistrationNumber.trim() || undefined,
        consent: true,
      });
      setDone(v.email.trim());
    } catch (err) {
      setServerError(err instanceof ApiError && err.message ? err.message : t('international.form.failed'));
    } finally {
      setPending(false);
    }
  }

  const err = (k: string) =>
    errors[k] ? (
      <p id={`${k}-error`} className="mt-1 text-xs text-danger">
        {errors[k]}
      </p>
    ) : null;
  const aria = (k: string) => (errors[k] ? { 'aria-invalid': true, 'aria-describedby': `${k}-error` } : {});

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader maxWidth="3xl" backHref="/international" backLabel={t('employer.backToHire')} />
      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        {done ? (
          <div role="status" className="rounded-lg border border-brand/30 bg-white p-8 text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-brand" aria-hidden />
            <h1 className="mt-3 text-xl font-semibold text-ink">{t('employer.register.doneTitle')}</h1>
            <p className="mx-auto mt-2 max-w-md text-sm text-ink/70">{t('employer.register.doneBody', { email: done })}</p>
          </div>
        ) : (
          <div className="grid gap-8 lg:grid-cols-[1fr_18rem]">
            <form onSubmit={submit} noValidate className="space-y-5 rounded-lg border border-border bg-white p-6 sm:p-8">
              <div>
                <h1 className="text-2xl font-bold tracking-tight text-ink">{t('employer.register.title')}</h1>
                <p className="mt-1 text-sm text-ink/60">{t('employer.register.subtitle')}</p>
              </div>

              <fieldset className="space-y-4">
                <legend className="mb-3 text-sm font-semibold text-ink">{t('employer.register.organisation')}</legend>
                <div>
                  <Label htmlFor="reg-org" required>
                    {t('international.form.organisationName')}
                  </Label>
                  <Input id="reg-org" value={v.organisationName} onChange={set('organisationName')} maxLength={200} autoComplete="organization" {...aria('organisationName')} />
                  {err('organisationName')}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="reg-type" required>
                      {t('international.form.organisationType')}
                    </Label>
                    <Select id="reg-type" value={v.organisationType} onChange={set('organisationType')} {...aria('organisationType')}>
                      <option value="">—</option>
                      {employerTypeValues.map((type) => (
                        <option key={type} value={type}>
                          {t(`international.employerTypes.${type}`)}
                        </option>
                      ))}
                    </Select>
                    {err('organisationType')}
                  </div>
                  <div>
                    <Label htmlFor="reg-country" required>
                      {t('employer.register.country')}
                    </Label>
                    <Select id="reg-country" value={v.country} onChange={set('country')} {...aria('country')}>
                      <option value="">—</option>
                      {countries.sorted.map((c) => (
                        <option key={c.code} value={c.code}>
                          {c.name}
                        </option>
                      ))}
                    </Select>
                    {err('country')}
                  </div>
                  <div>
                    <Label htmlFor="reg-website">{t('international.form.website')}</Label>
                    <Input id="reg-website" value={v.website} onChange={set('website')} maxLength={255} autoComplete="url" />
                  </div>
                  <div>
                    <Label htmlFor="reg-regno">{t('employer.register.registrationNumber')}</Label>
                    <Input id="reg-regno" value={v.companyRegistrationNumber} onChange={set('companyRegistrationNumber')} maxLength={100} />
                  </div>
                </div>
              </fieldset>

              <fieldset className="space-y-4 border-t border-border pt-5">
                <legend className="mb-3 text-sm font-semibold text-ink">{t('employer.register.you')}</legend>
                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <Label htmlFor="reg-name" required>
                      {t('international.form.contactName')}
                    </Label>
                    <Input id="reg-name" value={v.contactName} onChange={set('contactName')} maxLength={150} autoComplete="name" {...aria('contactName')} />
                    {err('contactName')}
                  </div>
                  <div>
                    <Label htmlFor="reg-phone">{t('international.form.phone')}</Label>
                    <Input id="reg-phone" type="tel" value={v.phone} onChange={set('phone')} placeholder="+81 90 1234 5678" maxLength={30} autoComplete="tel" {...aria('phone')} />
                    {err('phone')}
                  </div>
                  <div>
                    <Label htmlFor="reg-email" required>
                      {t('international.form.email')}
                    </Label>
                    <Input id="reg-email" type="email" value={v.email} onChange={set('email')} maxLength={255} autoComplete="email" {...aria('email')} />
                    {err('email')}
                  </div>
                  <div>
                    <Label htmlFor="reg-password" required>
                      {t('login.password')}
                    </Label>
                    <PasswordInput id="reg-password" value={v.password} onChange={set('password')} autoComplete="new-password" {...aria('password')} />
                    {err('password')}
                  </div>
                </div>
              </fieldset>

              <div>
                <label className="flex items-start gap-2.5 text-sm text-ink/80">
                  <input type="checkbox" checked={consent} onChange={(e) => setConsent(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-border text-brand focus:ring-brand" {...aria('consent')} />
                  <span>{t('employer.register.consent')}</span>
                </label>
                {err('consent')}
              </div>

              {serverError && (
                <p role="alert" className="rounded border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
                  {serverError}
                </p>
              )}

              <div className="flex flex-wrap items-center gap-4">
                <Button type="submit" size="lg" disabled={pending}>
                  {pending ? t('international.form.sending') : t('employer.register.submit')}
                </Button>
                <p className="text-sm text-ink/60">
                  {t('employer.register.haveAccount')}{' '}
                  <Link href="/employer/login" className="font-medium text-brand-dark hover:underline">
                    {t('nav.signIn')}
                  </Link>
                </p>
              </div>
            </form>

            <aside className="h-fit space-y-4 rounded-lg border border-border bg-white p-5 text-sm">
              <h2 className="flex items-center gap-2 font-semibold text-ink">
                <ShieldCheck className="h-5 w-5 text-accent" aria-hidden />
                {t('employer.register.howTitle')}
              </h2>
              <ol className="list-inside list-decimal space-y-2 text-ink/70">
                {[1, 2, 3, 4].map((n) => (
                  <li key={n}>{t(`employer.register.how${n}`)}</li>
                ))}
              </ol>
              <p className="border-t border-border pt-3 text-xs text-ink/50">{t('employer.register.feeNote')}</p>
            </aside>
          </div>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
