'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2 } from 'lucide-react';
import { useTranslation, type Locale } from '@/lib/i18n/provider';
import { apiRequest, ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input, Label, FieldError } from '@/components/ui/input';
import { PersonalInfoFields } from '@/components/caregivers/personal-info-fields';
import { makePersonalInfoSchema } from '@/lib/schemas/personal-info';
import { useLocations } from '@/lib/hooks/use-caregivers';
import type { Location } from '@/lib/api/types';

const LOCALES: { value: Locale; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'si', label: 'සිං' },
  { value: 'ta', label: 'தமி' },
];

export default function RegisterPage() {
  const { t, locale, setLocale } = useTranslation();
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<RegisterResponse | null>(null);
  const { data: locations } = useLocations();

  // Create localized Zod schema using the t function
  const personalInfoSchemaLocalized = makePersonalInfoSchema(t);
  const registerSchema = personalInfoSchemaLocalized.extend({
    email: z.string().email(t('register.validation.email')),
    password: z.string().min(8, t('register.validation.password')),
    confirmPassword: z.string(),
    consentAccepted: z.boolean(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: t('register.validation.passwordMismatch'),
    path: ['confirmPassword'],
  })
  .refine((data) => data.consentAccepted === true, {
    message: t('register.validation.consentRequired'),
    path: ['consentAccepted'],
  });

  type RegisterValues = z.infer<typeof registerSchema>;

  interface RegisterResponse {
    caregiverId: string;
    registrationNumber: string;
    message: string;
    devVerificationUrl?: string;
  }

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) });

  const onSubmit = async (values: RegisterValues) => {
    setServerError(null);
    try {
      const { confirmPassword, ...payload } = values;
      const cleaned = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== '' && v !== undefined));
      const res = await apiRequest<RegisterResponse>('/auth/register-caregiver', { method: 'POST', body: cleaned });
      setResult(res);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Could not register. Please try again.');
    }
  };

  if (result) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-paper px-4">
        <div className="w-full max-w-md rounded-lg border border-border bg-white p-8 text-center">
          <CheckCircle2 size={40} className="mx-auto mb-4 text-brand" />
          <h1 className="mb-2 text-lg font-semibold text-ink">{t('register.successTitle')}</h1>
          <p className="mb-4 text-sm text-ink/60">{t('register.successBody')}</p>
          <p className="mb-4 text-xs text-ink/40">Registration number: {result.registrationNumber}</p>

          {result.devVerificationUrl && (
            <div className="mb-4 rounded border border-dashed border-accent bg-accent-light p-3 text-left">
              <p className="mb-2 text-xs font-medium text-accent">{t('register.devLinkLabel')}</p>
              <Link href={result.devVerificationUrl.replace(/^https?:\/\/[^/]+/, '')} className="break-all text-xs text-brand-dark underline">
                {result.devVerificationUrl}
              </Link>
            </div>
          )}

          <Link href="/login">
            <Button variant="secondary" className="w-full">
              {t('register.signIn')}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4 py-10">
      <div className="w-full max-w-2xl">
        <div className="mb-6 flex flex-col items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded bg-brand text-base font-bold text-white">CP</div>
          <div className="flex items-center gap-4">
            <div className="flex overflow-hidden rounded border border-border">
              {LOCALES.map((l) => (
                <button
                  key={l.value}
                  onClick={() => setLocale(l.value)}
                  className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                    locale === l.value ? 'bg-brand text-white' : 'bg-white text-ink/60 hover:bg-paper'
                  }`}
                  aria-pressed={locale === l.value}
                >
                  {l.label}
                </button>
              ))}
            </div>
          </div>
          <div className="text-center">
            <h1 className="text-lg font-semibold text-ink">{t('register.title')}</h1>
            <p className="text-sm text-ink/60">{t('register.subtitle')}</p>
          </div>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="rounded-lg border border-border bg-white p-6">
          <h2 className="mb-3 text-sm font-semibold text-ink">{t('register.accountSection')}</h2>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="email">{t('register.email')}</Label>
              <Input id="email" type="email" {...register('email')} />
              <FieldError message={errors.email?.message as string | undefined} />
            </div>
            <div>
              <Label htmlFor="password">{t('register.password')}</Label>
              <Input id="password" type="password" {...register('password')} />
              <FieldError message={errors.password?.message as string | undefined} />
            </div>
            <div>
              <Label htmlFor="confirmPassword">{t('register.confirmPassword')}</Label>
              <Input id="confirmPassword" type="password" {...register('confirmPassword')} />
              <FieldError message={errors.confirmPassword?.message as string | undefined} />
            </div>
          </div>

          <h2 className="mb-3 text-sm font-semibold text-ink">{t('register.personalSection')}</h2>
          <PersonalInfoFields register={register} errors={errors} locations={locations ?? []} />

          <label className="mt-6 flex items-start gap-2 text-sm text-ink">
            <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-border text-brand focus:ring-brand" {...register('consentAccepted')} />
            <span>{t('register.consentLabel')}</span>
          </label>
          <FieldError message={errors.consentAccepted?.message as string | undefined} />

          {serverError && <p className="mt-4 text-sm text-danger">{serverError}</p>}

          <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
            <p className="text-sm text-ink/60">
              {t('register.alreadyHaveAccount')}{' '}
              <Link href="/login" className="font-medium text-brand-dark hover:underline">
                {t('register.signIn')}
              </Link>
            </p>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('common.loading') : t('register.submit')}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}