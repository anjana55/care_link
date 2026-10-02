'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { useTranslation } from '@/lib/i18n';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { useAuth } from '@/lib/api/auth-context';
import { ApiError } from '@/lib/api/client';
import { useWhatsappConfig } from '@/lib/hooks/use-whatsapp-config';
import { Input, Label } from '@/components/ui/input';

interface LoginValues {
  email: string;
  password: string;
}

export default function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const router = useRouter();
  const { data: whatsapp } = useWhatsappConfig();
  const [serverError, setServerError] = useState<string | null>(null);

  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<LoginValues>();

  const onSubmit = async (values: LoginValues) => {
    setServerError(null);
    try {
      await login(values.email, values.password);
      router.push('/');
    } catch (err) {
      // Fall back to the generic string only when there is no message to
      // show, so a validation error isn't reported as a wrong password.
      setServerError(err instanceof ApiError && err.message ? err.message : t('login.error'));
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader maxWidth="sm" />

      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm rounded-lg border border-border bg-white p-8">
          <h1 className="text-lg font-semibold text-ink">{t('login.title')}</h1>
          <p className="mt-1 text-sm text-ink/60">{t('login.subtitle')}</p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
            <div>
              <Label htmlFor="email" >
                {t('login.email')}
              </Label>
              <Input
                id="email"
                type="email"
                {...register('email', { required: true })}
              />
            </div>
            <div>
              <Label htmlFor="password" >
                {t('login.password')}
              </Label>
              <Input
                id="password"
                type="password"
                {...register('password', { required: true })}
              />
            </div>

            {serverError && (
              <div>
                <p className="text-sm text-danger">{serverError}</p>
                <p className="mt-1 text-xs text-ink/40">{t('login.unverifiedHint')}</p>
              </div>
            )}

            <button
              type="submit"
              disabled={isSubmitting}
              className="w-full rounded-DEFAULT bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
            >
              {isSubmitting ? '…' : t('login.submit')}
            </button>

            {whatsapp?.customer.login && (
              <p className="text-center text-sm text-ink/60">
                {t('whatsapp.login.noEmail')}{' '}
                <Link href="/login/whatsapp" className="font-medium text-brand-dark hover:underline">
                  {t('whatsapp.login.useWhatsapp')}
                </Link>
              </p>
            )}

            <p className="text-center text-sm text-ink/60">
              {t('login.noAccount')}{' '}
              <Link href="/register" className="font-medium text-brand-dark hover:underline">
                {t('login.signUp')}
              </Link>
            </p>
          </form>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}
