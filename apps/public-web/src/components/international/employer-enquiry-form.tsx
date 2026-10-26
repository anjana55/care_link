'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, Send } from 'lucide-react';
import {
  careTypeValues,
  employerTypeValues,
  visaSponsorshipValues,
  type CareType,
  type CountryCode,
  type EmployerType,
  type VisaSponsorship,
} from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useCountryNames } from '@/lib/countries';
import { useSendEnquiry } from '@/lib/hooks/use-international';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface Props {
  /** Set when the employer came from a shared profile: the enquiry is about this caregiver. */
  talent?: { slug: string; firstName: string } | null;
  onClearTalent?: () => void;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PHONE = /^\+?[0-9 ()-]{6,30}$/;

/**
 * An overseas employer telling us what they need. Goes to the staff Overseas
 * enquiries queue - nobody's contact details are exchanged here, in either
 * direction: staff contact the employer and make every introduction.
 */
export function EmployerEnquiryForm({ talent, onClearTalent }: Props) {
  const { t, locale } = useTranslation();
  const countries = useCountryNames();
  const send = useSendEnquiry();

  const [organisationName, setOrganisationName] = useState('');
  const [organisationType, setOrganisationType] = useState<EmployerType | ''>('');
  const [country, setCountry] = useState<CountryCode | ''>('');
  const [contactName, setContactName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [rolesCount, setRolesCount] = useState('1');
  const [careSettings, setCareSettings] = useState<CareType[]>([]);
  const [languages, setLanguages] = useState('');
  const [startTimeframe, setStartTimeframe] = useState('');
  const [visaSponsorship, setVisaSponsorship] = useState<VisaSponsorship>('UNSURE');
  const [message, setMessage] = useState('');
  const [consent, setConsent] = useState(false);
  const [honeypot, setHoneypot] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reference, setReference] = useState<string | null>(null);

  function validate() {
    const e: Record<string, string> = {};
    if (organisationName.trim().length < 2) e.organisationName = t('international.form.required');
    if (!organisationType) e.organisationType = t('international.form.required');
    if (!country) e.country = t('international.form.required');
    if (contactName.trim().length < 2) e.contactName = t('international.form.required');
    if (!EMAIL.test(email.trim())) e.email = t('international.form.invalidEmail');
    if (phone.trim() && !PHONE.test(phone.trim())) e.phone = t('international.form.invalidPhone');
    const roles = Number(rolesCount);
    if (!Number.isInteger(roles) || roles < 1 || roles > 500) e.rolesCount = t('international.form.invalidRoles');
    if (!careSettings.length) e.careSettings = t('international.form.chooseSetting');
    if (!consent) e.consent = t('international.form.consentRequired');
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!validate()) return;
    send.mutate(
      {
        organisationName: organisationName.trim(),
        organisationType: organisationType as EmployerType,
        country: country as CountryCode,
        contactName: contactName.trim(),
        email: email.trim(),
        phone: phone.trim() || undefined,
        website: website.trim() || undefined,
        rolesCount: Number(rolesCount),
        careSettings,
        languages: languages.trim() || undefined,
        startTimeframe: startTimeframe.trim() || undefined,
        visaSponsorship,
        message: message.trim() || undefined,
        talentSlug: talent?.slug,
        consent: true,
        language: locale,
        website2: honeypot || undefined,
      },
      { onSuccess: (receipt) => setReference(receipt.reference) },
    );
  }

  if (reference) {
    return (
      <div role="status" className="rounded-lg border border-brand/30 bg-brand-light/40 p-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-brand" aria-hidden />
        <h3 className="mt-3 text-lg font-semibold text-ink">{t('international.form.sentTitle')}</h3>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink/70">{t('international.form.sentBody', { reference })}</p>
      </div>
    );
  }

  const field = (name: string) => (errors[name] ? { 'aria-invalid': true, 'aria-describedby': `${name}-error` } : {});
  const error = (name: string) =>
    errors[name] ? (
      <p id={`${name}-error`} className="mt-1 text-xs text-danger">
        {errors[name]}
      </p>
    ) : null;

  return (
    <form onSubmit={submit} noValidate className="space-y-5" aria-label={t('international.form.title')}>
      {talent && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-DEFAULT border border-accent/30 bg-accent/5 px-3 py-2 text-sm text-ink">
          <span>{t('international.form.aboutTalent', { name: talent.firstName })}</span>
          {onClearTalent && (
            <button type="button" onClick={onClearTalent} className="text-xs font-medium text-accent-dark underline-offset-2 hover:underline">
              {t('international.form.aboutAnyone')}
            </button>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="enq-org" required>
            {t('international.form.organisationName')}
          </Label>
          <Input id="enq-org" value={organisationName} onChange={(e) => setOrganisationName(e.target.value)} maxLength={200} autoComplete="organization" {...field('organisationName')} />
          {error('organisationName')}
        </div>
        <div>
          <Label htmlFor="enq-type" required>
            {t('international.form.organisationType')}
          </Label>
          <Select id="enq-type" value={organisationType} onChange={(e) => setOrganisationType(e.target.value as EmployerType)} {...field('organisationType')}>
            <option value="">—</option>
            {employerTypeValues.map((type) => (
              <option key={type} value={type}>
                {t(`international.employerTypes.${type}`)}
              </option>
            ))}
          </Select>
          {error('organisationType')}
        </div>
        <div>
          <Label htmlFor="enq-country" required>
            {t('international.form.country')}
          </Label>
          <Select id="enq-country" value={country} onChange={(e) => setCountry(e.target.value as CountryCode)} {...field('country')}>
            <option value="">—</option>
            {countries.sorted.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name}
              </option>
            ))}
          </Select>
          {error('country')}
        </div>
        <div>
          <Label htmlFor="enq-contact" required>
            {t('international.form.contactName')}
          </Label>
          <Input id="enq-contact" value={contactName} onChange={(e) => setContactName(e.target.value)} maxLength={150} autoComplete="name" {...field('contactName')} />
          {error('contactName')}
        </div>
        <div>
          <Label htmlFor="enq-email" required>
            {t('international.form.email')}
          </Label>
          <Input id="enq-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} maxLength={255} autoComplete="email" {...field('email')} />
          {error('email')}
        </div>
        <div>
          <Label htmlFor="enq-phone">{t('international.form.phone')}</Label>
          <Input id="enq-phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="+81 90 1234 5678" maxLength={30} autoComplete="tel" {...field('phone')} />
          {error('phone')}
        </div>
        <div>
          <Label htmlFor="enq-website">{t('international.form.website')}</Label>
          <Input id="enq-website" value={website} onChange={(e) => setWebsite(e.target.value)} maxLength={255} autoComplete="url" />
        </div>
      </div>

      <fieldset aria-describedby={errors.careSettings ? 'careSettings-error' : undefined}>
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
                className={cn(
                  'rounded-full border px-3 py-1.5 text-sm transition-colors',
                  on ? 'border-brand bg-brand text-white' : 'border-border bg-white text-ink hover:border-brand',
                )}
              >
                {t(`careTypes.${type}`)}
              </button>
            );
          })}
        </div>
        {error('careSettings')}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <div>
          <Label htmlFor="enq-roles" required>
            {t('international.form.rolesCount')}
          </Label>
          <Input id="enq-roles" type="number" min={1} max={500} value={rolesCount} onChange={(e) => setRolesCount(e.target.value)} {...field('rolesCount')} />
          {error('rolesCount')}
        </div>
        <div>
          <Label htmlFor="enq-start">{t('international.form.startTimeframe')}</Label>
          <Input id="enq-start" value={startTimeframe} onChange={(e) => setStartTimeframe(e.target.value)} placeholder={t('international.form.startPlaceholder')} maxLength={100} />
        </div>
        <div>
          <Label htmlFor="enq-visa">{t('international.form.visaSponsorship')}</Label>
          <Select id="enq-visa" value={visaSponsorship} onChange={(e) => setVisaSponsorship(e.target.value as VisaSponsorship)}>
            {visaSponsorshipValues.map((v) => (
              <option key={v} value={v}>
                {t(`international.visa.${v}`)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      <div>
        <Label htmlFor="enq-languages">{t('international.form.languages')}</Label>
        <Input id="enq-languages" value={languages} onChange={(e) => setLanguages(e.target.value)} placeholder={t('international.form.languagesPlaceholder')} maxLength={255} />
      </div>

      <div>
        <Label htmlFor="enq-message">{t('international.form.message')}</Label>
        <Textarea id="enq-message" rows={4} value={message} onChange={(e) => setMessage(e.target.value)} placeholder={t('international.form.messagePlaceholder')} maxLength={3000} />
      </div>

      {/* Honeypot: hidden from people and from screen readers; bots fill every field they find. */}
      <div aria-hidden className="absolute -left-[9999px] h-0 w-0 overflow-hidden">
        <label htmlFor="enq-website2">Leave this empty</label>
        <input id="enq-website2" tabIndex={-1} autoComplete="off" value={honeypot} onChange={(e) => setHoneypot(e.target.value)} />
      </div>

      <div>
        <label className="flex items-start gap-2.5 text-sm text-ink/80">
          <input
            type="checkbox"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border text-brand focus:ring-brand"
            {...field('consent')}
          />
          <span>{t('international.form.consent')}</span>
        </label>
        {error('consent')}
      </div>

      {send.isError && (
        <p role="alert" className="rounded border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {send.error instanceof ApiError && send.error.status === 429 ? t('international.form.tooMany') : t('international.form.failed')}
        </p>
      )}

      <div className="flex flex-wrap items-center gap-4">
        <Button type="submit" size="lg" disabled={send.isPending}>
          <Send className="h-4 w-4" aria-hidden />
          {send.isPending ? t('international.form.sending') : t('international.form.submit')}
        </Button>
        <p className="text-xs text-ink/60">
          {t('international.form.feeNote')}{' '}
          <Link href="#faq" className="font-medium text-brand underline-offset-2 hover:underline">
            {t('international.form.feeLink')}
          </Link>
        </p>
      </div>
    </form>
  );
}
