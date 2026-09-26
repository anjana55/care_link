'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { CheckCircle2, MessageCircle, Heart, Send } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/common/language-switcher';
import { HeroBanner } from '@/components/register/hero-banner';
import { api, ApiError } from '@/lib/api/client';

interface RegisterResponse {
  patientId: string;
  message: string;
  devVerificationUrl?: string;
}

function makeRegisterSchema(t: (key: string) => string) {
  return z
    .object({
      fullName: z.string().min(2, t('register.validation.fullName')),
      email: z.string().email(t('register.validation.email')),
      phone: z.string().optional().or(z.literal('')),
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
}

export default function RegisterPage() {
  const { t } = useTranslation();
  const formRef = useRef<HTMLDivElement>(null);
  const [serverError, setServerError] = useState<string | null>(null);
  const [result, setResult] = useState<RegisterResponse | null>(null);

  const registerSchema = makeRegisterSchema(t);
  type RegisterValues = z.infer<typeof registerSchema>;

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<RegisterValues>({ resolver: zodResolver(registerSchema) });

  const scrollToForm = () => formRef.current?.scrollIntoView({ behavior: 'smooth' });

  const onSubmit = async (values: RegisterValues) => {
    setServerError(null);
    try {
      const { confirmPassword: _confirmPassword, ...payload } = values;
      const cleaned = { ...payload, phone: payload.phone || undefined };
      const res = await api.post<RegisterResponse>('/auth/register-patient', cleaned);
      setResult(res);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Could not register. Please try again.');
    }
  };

  return (
    <main>
      <header className="border-b border-border bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="text-sm font-semibold text-brand-dark">
            {t('nav.brand')}
          </Link>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            <Link href="/login" className="text-sm font-medium text-ink/60 hover:text-ink">
              {t('nav.signIn')}
            </Link>
          </div>
        </div>
      </header>

      {/* Hero - single-page site opens with a full banner, headline and a
          direct CTA down to the signup form, per the one-page brief. */}
      <section className="mx-auto grid max-w-5xl items-center gap-8 px-4 py-10 sm:grid-cols-2 sm:py-16">
        <div className="text-center sm:text-left">
          <h1 className="text-3xl font-bold text-ink sm:text-4xl">{t('register.heroTitle')}</h1>
          <p className="mx-auto mt-3 max-w-md text-ink/60 sm:mx-0">{t('register.heroSubtitle')}</p>
          <button
            type="button"
            onClick={scrollToForm}
            className="mt-6 inline-flex items-center rounded-DEFAULT bg-brand px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            {t('register.heroCta')}
          </button>
        </div>
        <HeroBanner alt={t('register.heroImageAlt')} />
      </section>

      {/* Benefits - short, so the signup form still dominates the page. */}
      <section className="bg-brand-light/40 py-10">
        <div className="mx-auto grid max-w-4xl gap-6 px-4 sm:grid-cols-3">
          <div className="text-center">
            <MessageCircle className="mx-auto mb-2 h-7 w-7 text-brand" aria-hidden />
            <h3 className="text-sm font-semibold text-ink">{t('register.benefit1Title')}</h3>
            <p className="mt-1 text-sm text-ink/60">{t('register.benefit1Body')}</p>
          </div>
          <div className="text-center">
            <Heart className="mx-auto mb-2 h-7 w-7 text-brand" aria-hidden />
            <h3 className="text-sm font-semibold text-ink">{t('register.benefit2Title')}</h3>
            <p className="mt-1 text-sm text-ink/60">{t('register.benefit2Body')}</p>
          </div>
          <div className="text-center">
            <Send className="mx-auto mb-2 h-7 w-7 text-brand" aria-hidden />
            <h3 className="text-sm font-semibold text-ink">{t('register.benefit3Title')}</h3>
            <p className="mt-1 text-sm text-ink/60">{t('register.benefit3Body')}</p>
          </div>
        </div>
      </section>

      {/* Signup form - the page's actual purpose. */}
      <section ref={formRef} className="mx-auto max-w-md px-4 py-12">
        {result ? (
          <div className="rounded-lg border border-border bg-white p-8 text-center">
            <CheckCircle2 size={40} className="mx-auto mb-4 text-brand" />
            <h2 className="mb-2 text-lg font-semibold text-ink">{t('register.successTitle')}</h2>
            <p className="mb-4 text-sm text-ink/60">{t('register.successBody')}</p>

            {result.devVerificationUrl && (
              <div className="mb-4 rounded border border-dashed border-accent bg-accent-light p-3 text-left">
                <p className="mb-2 text-xs font-medium text-accent">{t('register.devLinkLabel')}</p>
                <Link
                  href={result.devVerificationUrl.replace(/^https?:\/\/[^/]+/, '')}
                  className="break-all text-xs text-brand-dark underline"
                >
                  {result.devVerificationUrl}
                </Link>
              </div>
            )}

            <Link href="/" className="text-sm font-medium text-brand-dark hover:underline">
              {t('register.backHome')}
            </Link>
          </div>
        ) : (
          <div className="rounded-lg border border-border bg-white p-6 sm:p-8">
            <h2 className="text-lg font-semibold text-ink">{t('register.formTitle')}</h2>
            <p className="mt-1 text-sm text-ink/60">{t('register.formSubtitle')}</p>

            <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
              <div>
                <label htmlFor="fullName" className="mb-1 block text-xs font-medium text-ink/60">
                  {t('register.fullName')}
                </label>
                <input
                  id="fullName"
                  className="w-full rounded-DEFAULT border border-border bg-white px-3 py-2 text-sm"
                  {...register('fullName')}
                />
                {errors.fullName && <p className="mt-1 text-xs text-danger">{errors.fullName.message}</p>}
              </div>

              <div>
                <label htmlFor="email" className="mb-1 block text-xs font-medium text-ink/60">
                  {t('register.email')}
                </label>
                <input
                  id="email"
                  type="email"
                  className="w-full rounded-DEFAULT border border-border bg-white px-3 py-2 text-sm"
                  {...register('email')}
                />
                {errors.email && <p className="mt-1 text-xs text-danger">{errors.email.message}</p>}
              </div>

              <div>
                <label htmlFor="phone" className="mb-1 block text-xs font-medium text-ink/60">
                  {t('register.phone')}
                </label>
                <input
                  id="phone"
                  type="tel"
                  className="w-full rounded-DEFAULT border border-border bg-white px-3 py-2 text-sm"
                  {...register('phone')}
                />
                {errors.phone && <p className="mt-1 text-xs text-danger">{errors.phone.message}</p>}
              </div>

              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <div>
                  <label htmlFor="password" className="mb-1 block text-xs font-medium text-ink/60">
                    {t('register.password')}
                  </label>
                  <input
                    id="password"
                    type="password"
                    className="w-full rounded-DEFAULT border border-border bg-white px-3 py-2 text-sm"
                    {...register('password')}
                  />
                  {errors.password && <p className="mt-1 text-xs text-danger">{errors.password.message}</p>}
                </div>
                <div>
                  <label htmlFor="confirmPassword" className="mb-1 block text-xs font-medium text-ink/60">
                    {t('register.confirmPassword')}
                  </label>
                  <input
                    id="confirmPassword"
                    type="password"
                    className="w-full rounded-DEFAULT border border-border bg-white px-3 py-2 text-sm"
                    {...register('confirmPassword')}
                  />
                  {errors.confirmPassword && <p className="mt-1 text-xs text-danger">{errors.confirmPassword.message}</p>}
                </div>
              </div>

              <label className="flex items-start gap-2 text-sm text-ink">
                <input type="checkbox" className="mt-0.5 h-4 w-4 rounded border-border text-brand focus:ring-brand" {...register('consentAccepted')} />
                <span>{t('register.consentLabel')}</span>
              </label>
              {errors.consentAccepted && <p className="text-xs text-danger">{errors.consentAccepted.message}</p>}

              {serverError && <p className="text-sm text-danger">{serverError}</p>}

              <button
                type="submit"
                disabled={isSubmitting}
                className="w-full rounded-DEFAULT bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
              >
                {isSubmitting ? '…' : t('register.submit')}
              </button>

              <p className="text-center text-sm text-ink/60">
                {t('register.alreadyHaveAccount')}{' '}
                <Link href="/login" className="font-medium text-brand-dark hover:underline">
                  {t('register.signIn')}
                </Link>
              </p>
            </form>
          </div>
        )}
      </section>

      <footer className="border-t border-border py-6 text-center text-xs text-ink/40">
        <p className="mx-auto max-w-2xl px-4">{t('footer.disclaimer')}</p>
      </footer>
    </main>
  );
}
