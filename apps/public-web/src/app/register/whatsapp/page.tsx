'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation } from '@/lib/i18n';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { WhatsappOtpForm } from '@/components/auth/whatsapp-otp-form';
import { useAuth } from '@/lib/api/auth-context';
import { api, ApiError, type Tokens } from '@/lib/api/client';
import { useWhatsappConfig } from '@/lib/hooks/use-whatsapp-config';
import { FieldError, Input, Label, RequiredLegend } from '@/components/ui/input';
import { PatientIntakeFields } from '@/components/register/patient-intake-fields';
import { useLocationTree } from '@/lib/hooks/use-public-search';
import { UNSET_ID } from '@/lib/schemas/personal-info';
import { guardianFieldsCheck, makePatientIntakeSchema, toIntakePayload } from '@/lib/schemas/patient-intake';

interface RegisterResponse {
  patientId: string;
  message: string;
  otpSent: boolean;
  resendAfterSeconds: number;
  devOtp?: string;
}

function makeSchema(t: (key: string) => string) {
  // No email address on this flow, so EMAIL is not offered as a contact method.
  return makePatientIntakeSchema(t, { allowEmailContact: false })
    .extend({
      fullName: z.string().min(2, t('register.validation.fullName')),
      whatsappNumber: z.string().trim().min(1, t('whatsapp.register.validation.numberRequired')).min(7, t('whatsapp.register.validation.numberInvalid')),
      consentAccepted: z.boolean(),
    })
    .superRefine(guardianFieldsCheck(t))
    .refine((d) => d.consentAccepted === true, { message: t('register.validation.consentRequired'), path: ['consentAccepted'] });
}

function Header() {
  return <SiteHeader maxWidth="sm" />;
}

/** Customer sign-up for someone with no email address: a WhatsApp number, verified by a one-time code. */
export default function RegisterWhatsappPage() {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const { applyTokens } = useAuth();
  const { data: config, isLoading } = useWhatsappConfig();
  const { data: locationTree, isError: locationsUnavailable } = useLocationTree(locale);
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<{ phone: string; res: RegisterResponse } | null>(null);

  const schema = makeSchema(t);
  type Values = z.infer<typeof schema>;
  const {
    register,
    control,
    setValue,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<Values>({
    resolver: zodResolver(schema),
    defaultValues: {
      preferredContactTime: 'ANYTIME',
      preferredCaregiverGender: 'NO_PREFERENCE',
      districtId: UNSET_ID,
      cityId: UNSET_ID,
    },
  });

  async function onSubmit(values: Values) {
    setServerError(null);
    try {
      const payload = {
        fullName: values.fullName,
        whatsappNumber: values.whatsappNumber,
        consentAccepted: values.consentAccepted,
        ...toIntakePayload(values),
      };
      const res = await api.post<RegisterResponse>('/auth/whatsapp/register-patient', payload);
      setResult({ phone: values.whatsappNumber, res });
    } catch (err) {
      setServerError(err instanceof ApiError && err.message ? err.message : t('whatsapp.register.error'));
    }
  }

  function onVerified(tokens: Tokens) {
    applyTokens(tokens);
    router.push('/');
  }

  const card = 'mx-auto max-w-xl px-4 py-12';

  return (
    <main>
      <Header />
      <section className={card}>
        {isLoading ? (
          <p className="text-center text-sm text-ink/50">…</p>
        ) : !config?.customer.register ? (
          <div className="rounded-lg border border-border bg-white p-8 text-center">
            <p className="mb-4 text-sm text-ink/70">{t('whatsapp.unavailable')}</p>
            <Link href="/register" className="text-sm font-medium text-brand-dark hover:underline">{t('whatsapp.register.useEmail')}</Link>
          </div>
        ) : result ? (
          <div className="rounded-lg border border-border bg-white p-6 sm:p-8">
            <h1 className="text-lg font-semibold text-ink">{t('whatsapp.register.verifyTitle')}</h1>
            <p className="mb-4 mt-1 text-sm text-ink/60">{t('whatsapp.register.verifyBody')}</p>
            {!result.res.otpSent && <p role="alert" className="mb-4 text-sm text-danger">{t('whatsapp.register.notSent')}</p>}
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
        ) : (
          <div className="rounded-lg border border-border bg-white p-6 sm:p-8">
            <h1 className="text-lg font-semibold text-ink">{t('whatsapp.register.title')}</h1>
            <p className="mt-1 text-sm text-ink/60">{t('whatsapp.register.subtitle')}</p>

            <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
              <RequiredLegend label={t('common.requiredField')} />
              <div>
                <Label htmlFor="fullName" required>{t('register.fullName')}</Label>
                <Input id="fullName" {...register('fullName')} />
                {errors.fullName && <p className="mt-1 text-xs text-danger">{errors.fullName.message}</p>}
              </div>

              <div>
                <Label htmlFor="whatsappNumber" required>{t('whatsapp.register.number')}</Label>
                <Input
                  id="whatsappNumber"
                  type="tel"
                  inputMode="tel"
                  placeholder="0771234567"
                  {...register('whatsappNumber')}
                />
                <p className="mt-1 text-xs text-ink/50">{t('whatsapp.register.numberHint')}</p>
                <FieldError message={errors.whatsappNumber?.message} />
              </div>

              <PatientIntakeFields
                register={register}
                control={control}
                setValue={setValue}
                errors={errors}
                locationTree={locationTree}
                locationsUnavailable={locationsUnavailable}
                allowEmailContact={false}
              />

              <label className="flex items-start gap-2 border-t border-border pt-5 text-sm text-ink">
                <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-border text-brand focus:ring-brand" {...register('consentAccepted')} />
                <span>{t('register.consentLabel')}</span>
              </label>
              {errors.consentAccepted && <p className="text-xs text-danger">{errors.consentAccepted.message}</p>}

              {serverError && <p role="alert" className="text-sm text-danger">{serverError}</p>}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-DEFAULT bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
              >
                {isSubmitting ? '…' : t('whatsapp.register.submit')}
              </button>

              <p className="text-center text-sm text-ink/60">
                {t('register.alreadyHaveAccount')}{' '}
                <Link href="/login/whatsapp" className="font-medium text-brand-dark hover:underline">{t('register.signIn')}</Link>
              </p>
              <p className="text-center text-sm text-ink/60">
                <Link href="/register" className="font-medium text-brand-dark hover:underline">{t('whatsapp.register.useEmail')}</Link>
              </p>
            </form>
          </div>
        )}
      </section>

      <SiteFooter />
    </main>
  );
}
