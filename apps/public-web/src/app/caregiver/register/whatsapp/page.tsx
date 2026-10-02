'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from '@/lib/i18n';
import { useAuth } from '@/lib/api/auth-context';
import { api, ApiError, type Tokens } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input, Label, FieldError, RequiredLegend } from '@/components/ui/input';
import { PersonalInfoFields } from '@/components/caregivers/personal-info-fields';
import {
  CaregiverRegisterAlternate,
  CaregiverRegisterHeader,
  CaregiverRegisterShell,
} from '@/components/caregivers/caregiver-register-layout';
import { WhatsappOtpForm } from '@/components/auth/whatsapp-otp-form';
import { makePersonalInfoSchema, requiredFieldsOf } from '@/lib/schemas/personal-info';
import { useMetaLocations } from '@/lib/hooks/use-public-search';
import { useWhatsappConfig } from '@/lib/hooks/use-whatsapp-config';

/**
 * Where a caregiver lands once the OTP verifies. The profile wizard is still
 * served by the staff container (/staff/me) until it is relocated, so this
 * needs a full-page navigation rather than a client-side route change -
 * next/link and router.push only resolve routes inside this app.
 */
const POST_VERIFY_PATH = '/staff/me';

interface RegisterResponse {
  caregiverId: string;
  registrationNumber: string;
  message: string;
  otpSent: boolean;
  resendAfterSeconds: number;
  devOtp?: string;
}

/**
 * Caregiver sign-up for someone with no email address. The personal-information
 * form is the same component the email flow uses; only the account section
 * differs (a WhatsApp number instead of email + password), and the primary
 * phone becomes optional because it defaults to that WhatsApp number.
 */
export default function CaregiverRegisterWhatsappPage() {
  const { t } = useTranslation();
  const { applyTokens } = useAuth();
  const { data: config, isLoading: configLoading } = useWhatsappConfig();
  const { data: locations, isError: locationsUnavailable } = useMetaLocations();
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<{ phone: string; res: RegisterResponse } | null>(null);

  const personalSchema = makePersonalInfoSchema(t);
  const schema = personalSchema
    .extend({
      whatsappNumber: z.string().trim().min(1, t('whatsapp.register.validation.numberRequired')).min(7, t('whatsapp.register.validation.numberInvalid')),
      primaryPhone: z.string().trim().optional(),
      consentAccepted: z.boolean(),
    })
    .refine((d) => d.consentAccepted === true, {
      message: t('caregiverRegister.validation.consentRequired'),
      path: ['consentAccepted'],
    });
  type Values = z.infer<typeof schema>;
  const requiredFields = requiredFieldsOf(personalSchema.extend({ primaryPhone: z.string().optional() }));

  const {
    register,
    control,
    setValue,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({ resolver: zodResolver(schema) });

  const onSubmit = async (values: Values) => {
    setServerError(null);
    try {
      const cleaned = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '' && v !== undefined));
      const res = await api.post<RegisterResponse>('/auth/whatsapp/register-caregiver', cleaned);
      setResult({ phone: values.whatsappNumber, res });
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : t('whatsapp.register.error'));
    }
  };

  const onVerified = (tokens: Tokens) => {
    // The returned user tells us whether this decoded to a caregiver. If it
    // did not, something is wrong with the session and /staff/me would bounce
    // us to a login page we have not reached yet - so go to ours instead.
    const user = applyTokens(tokens);
    if (user?.role === 'CAREGIVER') {
      window.location.assign(POST_VERIFY_PATH);
    } else {
      window.location.assign('/caregiver/login');
    }
  };

  if (configLoading) {
    return <CaregiverRegisterShell narrow><p className="text-center text-sm text-ink/50">{t('common.loading')}</p></CaregiverRegisterShell>;
  }

  if (!config?.caregiver.register) {
    // Same shape as the join page's unavailable card: say why, and leave the
    // one route that still works within reach.
    return (
      <CaregiverRegisterShell narrow>
        <CaregiverRegisterHeader title={t('whatsapp.register.title')} subtitle={t('whatsapp.unavailable')}>
          <CaregiverRegisterAlternate href="/caregiver/register" linkText={t('whatsapp.register.useEmail')} />
        </CaregiverRegisterHeader>
      </CaregiverRegisterShell>
    );
  }

  if (result) {
    return (
      <CaregiverRegisterShell narrow>
        <div className="rounded-lg border border-border bg-white p-6">
          <h1 className="mb-1 text-lg font-semibold text-ink">{t('whatsapp.register.verifyTitle')}</h1>
          <p className="mb-1 text-sm text-ink/60">{t('whatsapp.register.verifyBody')}</p>
          <p className="mb-4 text-xs text-ink/40">
            {t('whatsapp.register.regNumber')} {result.res.registrationNumber}
          </p>
          {!result.res.otpSent && <p className="mb-4 text-sm text-danger">{t('whatsapp.register.notSent')}</p>}
          <WhatsappOtpForm
            phone={result.phone}
            purpose="REGISTER"
            codeLength={config.otpLength}
            resendAfterSeconds={result.res.resendAfterSeconds}
            devOtp={result.res.devOtp}
            onVerified={onVerified}
            onChangeNumber={() => setResult(null)}
          />
        </div>
      </CaregiverRegisterShell>
    );
  }

  return (
    <CaregiverRegisterShell>
      <CaregiverRegisterHeader title={t('whatsapp.register.title')} subtitle={t('whatsapp.register.subtitle')}>
        <CaregiverRegisterAlternate href="/caregiver/register" linkText={t('whatsapp.register.useEmail')} />
      </CaregiverRegisterHeader>

      <form onSubmit={handleSubmit(onSubmit)} className="rounded-lg border border-border bg-white p-6">
        <RequiredLegend label={t('common.requiredField')} />
        <h2 className="mb-3 text-sm font-semibold text-ink">{t('caregiverRegister.accountSection')}</h2>
        <div className="mb-6">
          <Label htmlFor="whatsappNumber" required>{t('whatsapp.register.number')}</Label>
          <Input
            id="whatsappNumber"
            type="tel"
            inputMode="tel"
            placeholder="0771234567"
            {...register('whatsappNumber')}
          />
          <p className="mt-1 text-xs text-ink/50">{t('whatsapp.register.numberHint')}</p>
          <FieldError message={errors.whatsappNumber?.message as string | undefined} />
        </div>

        <h2 className="mb-3 text-sm font-semibold text-ink">{t('caregiverRegister.personalSection')}</h2>
        <PersonalInfoFields
          register={register as any}
          control={control as any}
          setValue={setValue as any}
          errors={errors as any}
          locations={locations ?? []}
          locationsUnavailable={locationsUnavailable}
          requiredFields={requiredFields}
        />
        <p className="mt-1 text-xs text-ink/50">{t('whatsapp.register.primaryPhoneHint')}</p>

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
            <Link href="/caregiver/login/whatsapp" className="font-medium text-brand-dark hover:underline">
              {t('caregiverRegister.signIn')}
            </Link>
          </p>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? t('common.loading') : t('whatsapp.register.submit')}
          </Button>
        </div>
      </form>
    </CaregiverRegisterShell>
  );
}