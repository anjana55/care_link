'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from '@/lib/i18n';
import { api, ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input, Label, FieldError, RequiredLegend } from '@/components/ui/input';
import { PersonalInfoFields } from '@/components/caregivers/personal-info-fields';
import { CaregiverRegisterHeader, CaregiverRegisterShell } from '@/components/caregivers/caregiver-register-layout';
import { ProviderChoices } from '@/components/caregivers/provider-choices';
import {
  makeUnifiedSignupSchema,
  unifiedSignupRequiredFields,
  type UnifiedSignupValues,
} from '@/lib/schemas/caregiver-unified-signup';
import { useLocationTree } from '@/lib/hooks/use-public-search';

/**
 * The one caregiver registration form.
 *
 * Replaces the split where the WhatsApp page asked for a WhatsApp number *and*
 * still carried a primary phone field. This page asks for one number, calls it
 * what it is, and takes an optional email address alongside it.
 *
 * Two screens in one component, switched after a successful POST. They are
 * separate routes in the API, not two steps of one POST, because the second
 * screen sends the caregiver off-site to a provider and needs a token that
 * survives the round trip - so there is nothing to gain from hiding the second
 * screen behind a client-side step that a refresh would lose.
 */

interface RegisterResponse {
  caregiverId: string;
  registrationNumber: string;
  message: string;
  pendingToken: string;
  pendingTokenExpiresInSeconds: number;
  providers: Record<'GOOGLE' | 'MICROSOFT' | 'FACEBOOK', boolean>;
}

/** `primaryPhone` is omitted because this page renders its own `phone` input. */
const OMIT = new Set(['primaryPhone']);

export default function CaregiverSignupPage() {
  const { t, locale } = useTranslation();
  const { data: locationTree, isError: locationsUnavailable } = useLocationTree(locale);
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<RegisterResponse | null>(null);
  // The provider step is optional: the registration is already saved by the
  // time it is shown, so a caregiver can decline it and finish here.
  const [skipped, setSkipped] = useState(false);

  const schema = makeUnifiedSignupSchema(t);
  const requiredFields = unifiedSignupRequiredFields(t);

  const {
    register,
    control,
    setValue,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<UnifiedSignupValues>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: UnifiedSignupValues) => {
    setServerError(null);
    try {
      // Blanks are dropped rather than sent: an untouched optional field is
      // '' and the API would reject it on IsEmail. An all-empty-string field is
      // a value nobody filled in, not one they filled in wrongly.
      const cleaned = Object.fromEntries(
        Object.entries(values).filter(([, v]) => v !== '' && v !== undefined && v !== false),
      );
      const res = await api.post<RegisterResponse>('/auth/register-caregiver/unified', cleaned);
      setResult(res);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : t('caregiverSignup.error'));
    }
  };

  if (result && skipped) {
    return (
      <CaregiverRegisterShell narrow>
        <div className="rounded-lg border border-border bg-white p-6 text-center">
          <h1 className="mb-1 text-lg font-semibold text-ink">{t('caregiverSignup.skippedTitle')}</h1>
          <p className="mb-1 text-sm text-ink/60">{t('caregiverSignup.skippedBody')}</p>
          <p className="mb-3 text-xs text-ink/40">
            {t('caregiverSignup.regNumber')} {result.registrationNumber}
          </p>
          <p className="mb-5 text-xs text-ink/60">
            {t('caregiverSignup.finishLaterHint')}{' '}
            <Link href="/caregiver/claim" className="font-medium text-brand-dark hover:underline">
              {t('caregiverClaim.finishCta')}
            </Link>
          </p>
          <Link href="/" className="text-sm font-medium text-brand-dark hover:underline">
            {t('caregiverSignup.backHome')}
          </Link>
        </div>
      </CaregiverRegisterShell>
    );
  }

  if (result) {
    return (
      <CaregiverRegisterShell narrow>
        <div className="rounded-lg border border-border bg-white p-6">
          <h1 className="mb-1 text-lg font-semibold text-ink">{t('caregiverSignup.successTitle')}</h1>
          <p className="mb-1 text-sm text-ink/60">{t('caregiverSignup.successBody')}</p>
          <p className="mb-5 text-xs text-ink/40">
            {t('caregiverSignup.regNumber')} {result.registrationNumber}
          </p>
          <ProviderChoices
            pendingToken={result.pendingToken}
            providers={result.providers}
            expiresInSeconds={result.pendingTokenExpiresInSeconds}
            expiredMessage={t('caregiverSignup.tokenExpired')}
          />
          <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => setSkipped(true)}
              className="text-sm font-medium text-brand-dark hover:underline"
            >
              {t('caregiverSignup.skip')}
            </button>
            <button
              type="button"
              onClick={() => setResult(null)}
              className="text-sm text-ink/60 underline hover:text-ink"
            >
              {t('caregiverSignup.useDifferentNumber')}
            </button>
          </div>
        </div>
      </CaregiverRegisterShell>
    );
  }

  return (
    <CaregiverRegisterShell>
      <CaregiverRegisterHeader title={t('caregiverSignup.title')} subtitle={t('caregiverSignup.subtitle')} />

      <form onSubmit={handleSubmit(onSubmit)} className="rounded-lg border border-border bg-white p-6">
        <RequiredLegend label={t('common.requiredField')} />

        <h2 className="mb-3 text-sm font-semibold text-ink">{t('caregiverRegister.accountSection')}</h2>
        <div className="mb-6 grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor="phone" required>{t('caregiverSignup.phone')}</Label>
            <Input id="phone" type="tel" inputMode="tel" placeholder="0771234567" {...register('phone')} />
            <p className="mt-1 text-xs text-ink/50">{t('caregiverSignup.phoneHint')}</p>
            <FieldError message={errors.phone?.message as string | undefined} />
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor="email">{t('caregiverSignup.email')}</Label>
            <Input id="email" type="email" autoComplete="email" {...register('email')} />
            <p className="mt-1 text-xs text-ink/50">{t('caregiverSignup.emailHint')}</p>
            <FieldError message={errors.email?.message as string | undefined} />
          </div>
        </div>

        <h2 className="mb-3 text-sm font-semibold text-ink">{t('caregiverRegister.personalSection')}</h2>
        <PersonalInfoFields
          register={register as any}
          control={control as any}
          setValue={setValue as any}
          errors={errors as any}
          locationTree={locationTree ?? []}
          locationsUnavailable={locationsUnavailable}
          requiredFields={requiredFields}
          omitFields={OMIT}
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
            {isSubmitting ? t('common.loading') : t('caregiverSignup.submit')}
          </Button>
        </div>
      </form>
    </CaregiverRegisterShell>
  );
}