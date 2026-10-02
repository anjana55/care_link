'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { useTranslation, type Locale } from '@/lib/i18n/provider';
import { AuthHeader } from '@/components/layout/brand-mark';
import { useAuth, postLoginPath } from '@/lib/api/auth-context';
import { api, ApiError, type Tokens } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input, Label, FieldError, RequiredLegend } from '@/components/ui/input';
import { PersonalInfoFields } from '@/components/caregivers/personal-info-fields';
import { WhatsappOtpForm } from '@/components/auth/whatsapp-otp-form';
import { makePersonalInfoSchema, requiredFieldsOf } from '@/lib/schemas/personal-info';
import { useLocations } from '@/lib/hooks/use-caregivers';
import { useWhatsappConfig } from '@/lib/hooks/use-whatsapp';

const LOCALES: { value: Locale; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'si', label: 'සිං' },
  { value: 'ta', label: 'தமி' },
];

interface RegisterResponse {
  caregiverId: string;
  registrationNumber: string;
  message: string;
  otpSent: boolean;
  resendAfterSeconds: number;
  devOtp?: string;
}

function Shell({ children, wide }: { children: React.ReactNode; wide?: boolean }) {
  // Module-level on purpose: declared inside the page component it would be a new
  // component type on every render, remounting the form and dropping typed input.
  const { locale, setLocale } = useTranslation();
  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <AuthHeader />
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className={`w-full ${wide ? 'max-w-2xl' : 'max-w-sm'}`}>
          <div className="mb-6 flex flex-col items-center gap-3">
            <div className="flex overflow-hidden rounded border border-border">
            {LOCALES.map((l) => (
              <button
                key={l.value}
                onClick={() => setLocale(l.value)}
                className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${locale === l.value ? 'bg-brand text-white' : 'bg-white text-ink/60 hover:bg-paper'}`}
                aria-pressed={locale === l.value}
              >
                {l.label}
              </button>
            ))}
          </div>
        </div>
        {children}
        </div>
      </div>
    </div>
  );
}

/**
 * Caregiver sign-up for someone with no email address. The personal-information
 * form is the same component the email flow uses; only the account section
 * differs (a WhatsApp number instead of email + password), and the primary
 * phone becomes optional because it defaults to that WhatsApp number.
 */
export default function RegisterWhatsappPage() {
  const { t } = useTranslation();
  const router = useRouter();
  const { applyTokens } = useAuth();
  const { data: config, isLoading: configLoading } = useWhatsappConfig();
  const { data: locations } = useLocations();
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<{ phone: string; res: RegisterResponse } | null>(null);

  const personalSchema = makePersonalInfoSchema(t);
  const schema = personalSchema
    .extend({
      whatsappNumber: z.string().trim().min(1, t('whatsapp.register.validation.number.required')).min(7, t('whatsapp.register.validation.number.invalid')),
      primaryPhone: z.string().trim().optional(),
      consentAccepted: z.boolean(),
    })
    .refine((d) => d.consentAccepted === true, { message: t('register.validation.consentRequired'), path: ['consentAccepted'] });
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
    const user = applyTokens(tokens);
    router.push(user ? postLoginPath(user) : '/login');
  };

  if (configLoading) return <Shell><p className="text-center text-sm text-ink/50">{t('common.loading')}</p></Shell>;

  if (!config?.caregiver.register) {
    return (
      <Shell>
        <div className="rounded-lg border border-border bg-white p-6 text-center">
          <p className="mb-4 text-sm text-ink/70">{t('whatsapp.unavailable')}</p>
          <Link href="/register" className="text-sm font-medium text-brand-dark hover:underline">{t('whatsapp.register.useEmail')}</Link>
        </div>
      </Shell>
    );
  }

  if (result) {
    return (
      <Shell>
        <div className="rounded-lg border border-border bg-white p-6">
          <h1 className="mb-1 text-lg font-semibold text-ink">{t('whatsapp.register.verifyTitle')}</h1>
          <p className="mb-1 text-sm text-ink/60">{t('whatsapp.register.verifyBody')}</p>
          <p className="mb-4 text-xs text-ink/40">{t('whatsapp.register.regNumber')} {result.res.registrationNumber}</p>
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
      </Shell>
    );
  }

  return (
    <Shell wide>
      <div className="mb-6 text-center">
        <h1 className="text-lg font-semibold text-ink">{t('whatsapp.register.title')}</h1>
        <p className="text-sm text-ink/60">{t('whatsapp.register.subtitle')}</p>
      </div>

      <form onSubmit={handleSubmit(onSubmit)} className="rounded-lg border border-border bg-white p-6">
        <RequiredLegend label={t('common.requiredField')} />
        <h2 className="mb-3 text-sm font-semibold text-ink">{t('register.accountSection')}</h2>
        <div className="mb-6">
          <Label htmlFor="whatsappNumber" required>{t('whatsapp.register.number')}</Label>
          <Input id="whatsappNumber" type="tel" inputMode="tel" placeholder="0771234567" {...register('whatsappNumber')} />
          <p className="mt-1 text-xs text-ink/50">{t('whatsapp.register.numberHint')}</p>
          <FieldError message={errors.whatsappNumber?.message as string | undefined} />
        </div>

        <h2 className="mb-3 text-sm font-semibold text-ink">{t('register.personalSection')}</h2>
        <PersonalInfoFields
          register={register as any}
          control={control as any}
          setValue={setValue as any}
          errors={errors as any}
          locations={locations ?? []}
          requiredFields={requiredFields}
        />
        <p className="mt-1 text-xs text-ink/50">{t('whatsapp.register.primaryPhoneHint')}</p>

        <label className="mt-6 flex items-start gap-2 text-sm text-ink">
          <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-border text-brand focus:ring-brand" {...register('consentAccepted')} />
          <span>
            <span aria-hidden="true" className="text-danger">*</span> {t('register.consentLabel')}
          </span>
        </label>
        <FieldError message={errors.consentAccepted?.message as string | undefined} />

        {serverError && <p className="mt-4 text-sm text-danger">{serverError}</p>}

        <div className="mt-6 flex items-center justify-between border-t border-border pt-4">
          <p className="text-sm text-ink/60">
            {t('register.alreadyHaveAccount')}{' '}
            <Link href="/login/whatsapp" className="font-medium text-brand-dark hover:underline">{t('register.signIn')}</Link>
          </p>
          <Button type="submit" disabled={isSubmitting}>
            {isSubmitting ? t('common.loading') : t('whatsapp.register.submit')}
          </Button>
        </div>
      </form>

      <p className="mt-4 text-center text-sm text-ink/60">
        <Link href="/register" className="font-medium text-brand-dark hover:underline">{t('whatsapp.register.useEmail')}</Link>
      </p>
    </Shell>
  );
}
