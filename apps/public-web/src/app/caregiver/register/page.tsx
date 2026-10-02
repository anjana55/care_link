'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2 } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { api, ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input, Label, FieldError, RequiredLegend } from '@/components/ui/input';
import { PersonalInfoFields } from '@/components/caregivers/personal-info-fields';
import { makePersonalInfoSchema, requiredFieldsOf } from '@/lib/schemas/personal-info';
import { useMetaLocations } from '@/lib/hooks/use-public-search';
import { useWhatsappConfig } from '@/lib/hooks/use-whatsapp-config';

/**
 * Caregiver self-registration by email, moved here from apps/web's
 * /staff/register. The API call, the field set and the validation rules are
 * unchanged - only the chrome and the URL are new, so the form looks and
 * behaves like every other page on the public site.
 */
export default function CaregiverRegisterPage() {
  const { t } = useTranslation();
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<RegisterResponse | null>(null);
  const { data: locations, isError: locationsUnavailable } = useMetaLocations();
  const { data: whatsapp } = useWhatsappConfig();

  // Rebuilt each render so t() is current; the WhatsApp link is only offered
  // when the caregiver flag is actually on.
  const personalSchema = makePersonalInfoSchema(t);
  const registerSchema = personalSchema
    .extend({
      email: z.string().trim().min(1, t('caregiverRegister.validation.email.required')).email(t('caregiverRegister.validation.email.invalid')),
      password: z.string().min(1, t('caregiverRegister.validation.password.required')).min(8, t('caregiverRegister.validation.password.invalid')),
      confirmPassword: z.string().min(1, t('caregiverRegister.validation.confirmPassword.required')),
      consentAccepted: z.boolean(),
    })
    .refine((data) => data.password === data.confirmPassword, {
      message: t('caregiverRegister.validation.passwordMismatch'),
      path: ['confirmPassword'],
    })
    .refine((data) => data.consentAccepted === true, {
      message: t('caregiverRegister.validation.consentRequired'),
      path: ['consentAccepted'],
    });

  type RegisterValues = z.infer<typeof registerSchema>;

  // Derived from the object schema, not registerSchema - the .refine() chain
  // returns a ZodEffects that has no .shape to inspect.
  const requiredFields = requiredFieldsOf(personalSchema);

  interface RegisterResponse {
    caregiverId: string;
    registrationNumber: string;
    message: string;
    devVerificationUrl?: string;
  }

  const {
    register,
    control,
    setValue,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) });

  const onSubmit = async (values: RegisterValues) => {
    setServerError(null);
    try {
      const { confirmPassword, ...payload } = values;
      const cleaned = Object.fromEntries(Object.entries(payload).filter(([, v]) => v !== '' && v !== undefined));
      const res = await api.post<RegisterResponse>('/auth/register-caregiver', cleaned);
      setResult(res);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : t('whatsapp.register.error'));
    }
  };

  if (result) {
    return (
      <div className="flex min-h-screen flex-col bg-paper">
        <SiteHeader maxWidth="sm" />
        <main className="mx-auto flex w-full max-w-md flex-1 items-center justify-center px-4 py-10">
          <div className="w-full rounded-lg border border-border bg-white p-8 text-center">
            <CheckCircle2 size={40} className="mx-auto mb-4 text-brand" aria-hidden />
            <h1 className="mb-2 text-lg font-semibold text-ink">{t('caregiverRegister.successTitle')}</h1>
            <p className="mb-4 text-sm text-ink/60">{t('caregiverRegister.successBody')}</p>
            <p className="mb-4 text-xs text-ink/40">
              {t('caregiverRegister.registrationNumber')}: {result.registrationNumber}
            </p>

            {result.devVerificationUrl && (
              <div className="mb-4 rounded border border-dashed border-accent bg-accent-light p-3 text-left">
                <p className="mb-2 text-xs font-medium text-accent">{t('caregiverRegister.devLinkLabel')}</p>
                <Link
                  href={result.devVerificationUrl.replace(/^https?:\/\/[^/]+/, '')}
                  className="break-all text-xs text-brand-dark underline"
                >
                  {result.devVerificationUrl}
                </Link>
              </div>
            )}

            <Link href="/caregiver/login">
              <Button variant="secondary" className="w-full">
                {t('caregiverRegister.signIn')}
              </Button>
            </Link>
          </div>
        </main>
        <SiteFooter />
      </div>
    );
  }

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <SiteHeader maxWidth="3xl" />

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10">
        <div className="mb-6 text-center">
          <h1 className="text-lg font-semibold text-ink">{t('caregiverRegister.title')}</h1>
          <p className="text-sm text-ink/60">{t('caregiverRegister.subtitle')}</p>
          {whatsapp?.caregiver.register && (
            <p className="mt-2 text-sm text-ink/60">
              {t('whatsapp.register.noEmail')}{' '}
              <Link href="/caregiver/register/whatsapp" className="font-medium text-brand-dark hover:underline">
                {t('whatsapp.register.link')}
              </Link>
            </p>
          )}
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="rounded-lg border border-border bg-white p-6">
          <RequiredLegend label={t('common.requiredField')} />
          <h2 className="mb-3 text-sm font-semibold text-ink">{t('caregiverRegister.accountSection')}</h2>
          <div className="mb-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="email" required>{t('caregiverRegister.email')}</Label>
              <Input id="email" type="email" {...register('email')} />
              <FieldError message={errors.email?.message as string | undefined} />
            </div>
            <div>
              <Label htmlFor="password" required>{t('caregiverRegister.password')}</Label>
              <Input id="password" type="password" {...register('password')} />
              <FieldError message={errors.password?.message as string | undefined} />
            </div>
            <div>
              <Label htmlFor="confirmPassword" required>{t('caregiverRegister.confirmPassword')}</Label>
              <Input id="confirmPassword" type="password" {...register('confirmPassword')} />
              <FieldError message={errors.confirmPassword?.message as string | undefined} />
            </div>
          </div>

          <h2 className="mb-3 text-sm font-semibold text-ink">{t('caregiverRegister.personalSection')}</h2>
          <PersonalInfoFields
            register={register}
            control={control}
            setValue={setValue}
            errors={errors}
            locations={locations ?? []}
            locationsUnavailable={locationsUnavailable}
            requiredFields={requiredFields}
          />

          <label className="mt-6 flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="mt-0.5 h-4 w-4 rounded border-border text-brand focus:ring-brand"
              {...register('consentAccepted')}
            />
            <span>
              <span aria-hidden="true" className="text-danger">*</span> {t('caregiverRegister.consentLabel')}
            </span>
          </label>
          <FieldError message={errors.consentAccepted?.message as string | undefined} />

          {serverError && <p className="mt-4 text-sm text-danger">{serverError}</p>}

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
            <p className="text-sm text-ink/60">
              {t('caregiverRegister.alreadyHaveAccount')}{' '}
              <Link href="/caregiver/login" className="font-medium text-brand-dark hover:underline">
                {t('caregiverRegister.signIn')}
              </Link>
            </p>
            <Button type="submit" disabled={isSubmitting}>
              {isSubmitting ? t('common.loading') : t('caregiverRegister.submit')}
            </Button>
          </div>
        </form>
      </main>

      <SiteFooter />
    </div>
  );
}