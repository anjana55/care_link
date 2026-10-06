'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useForm } from 'react-hook-form';
import { useTranslation } from '@/lib/i18n';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { useAuth } from '@/lib/api/auth-context';
import { ApiError } from '@/lib/api/client';
import { useWhatsappConfig } from '@/lib/hooks/use-whatsapp-config';
import { Button } from '@/components/ui/button';
import { Input, Label, RequiredLegend } from '@/components/ui/input';
import { SocialLoginButtons } from '@/components/caregivers/social-login-buttons';

/**
 * Caregiver sign-in, the counterpart to /caregiver/signup.
 *
 * Three ways in: Google / Microsoft / Facebook (for caregivers who linked one
 * at registration), email + password, and WhatsApp OTP (when enabled).
 *
 * Separate from /login (patients) and from /staff/login (office staff) so a
 * caregiver never has to enter the staff area. On success the session is
 * established here and the caregiver's profile wizard is loaded from wherever
 * it currently lives.
 */
export default function CaregiverLoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const { data: whatsapp } = useWhatsappConfig();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<{ email: string; password: string }>();

  const onSubmit = async (values: { email: string; password: string }) => {
    setServerError(null);
    try {
      await login(values.email, values.password);
      // The caregiver's own area is in this app (the old /staff/me wizard reads
      // its tokens from a different localStorage key, so it would have opened
      // signed out).
      window.location.assign('/caregiver/dashboard');
    } catch (err) {
      // Surface the server's actual message. The API returns one message for
      // both "no such user" and "wrong password", so this leaks nothing about
      // which accounts exist - but it does keep a validation 400 from being
      // reported as a wrong password.
      setServerError(err instanceof ApiError && err.message ? err.message : t('login.error'));
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader maxWidth="sm" />

      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm rounded-lg border border-border bg-white p-8">
          <h1 className="text-lg font-semibold text-ink">{t('caregiverLogin.title')}</h1>
          <p className="mt-1 text-sm text-ink/60">{t('caregiverLogin.subtitle')}</p>

          <div className="mt-6">
            <SocialLoginButtons>
              <div className="my-5 flex items-center gap-3 text-xs text-ink/40" role="separator">
                <span className="h-px flex-1 bg-border" />
                {t('caregiverLogin.orEmail')}
                <span className="h-px flex-1 bg-border" />
              </div>
            </SocialLoginButtons>
          </div>

          <form onSubmit={handleSubmit(onSubmit)}>
            <RequiredLegend label={t('common.requiredField')} />
            <div className="space-y-4">
              <div>
                <Label htmlFor="email" required>{t('login.email')}</Label>
                <Input id="email" type="email" {...register('email', { required: true })} />
              </div>
              <div>
                <Label htmlFor="password" required>{t('login.password')}</Label>
                <Input id="password" type="password" {...register('password', { required: true })} />
              </div>

              {serverError && (
                <div>
                  <p role="alert" className="text-sm text-danger">{serverError}</p>
                  <p className="mt-1 text-xs text-ink/40">{t('login.unverifiedHint')}</p>
                </div>
              )}

              <Button type="submit" className="w-full" disabled={isSubmitting}>
                {isSubmitting ? t('common.loading') : t('login.submit')}
              </Button>
            </div>
          </form>

          {whatsapp?.caregiver.login && (
            <p className="mt-6 text-center text-sm text-ink/60">
              {t('whatsapp.login.noEmail')}{' '}
              <Link href="/caregiver/login/whatsapp" className="font-medium text-brand-dark hover:underline">
                {t('whatsapp.login.useWhatsapp')}
              </Link>
            </p>
          )}

          <p className="mt-4 text-center text-sm text-ink/60">
            {t('caregiverLogin.noAccount')}{' '}
            <Link href="/caregiver/signup" className="font-medium text-brand-dark hover:underline">
              {t('caregiverRegister.join.title')}
            </Link>
          </p>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}