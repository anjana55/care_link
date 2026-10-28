'use client';

import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useForm } from 'react-hook-form';
import { Globe2 } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { useAuth } from '@/lib/api/auth-context';
import { ApiError } from '@/lib/api/client';
import { Input, Label } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { takeReturnTo } from '@/lib/return-to';

/** Sign-in for overseas employers. The API refuses any other kind of account here as a wrong password. */
export default function EmployerLoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { isSubmitting },
  } = useForm<{ email: string; password: string }>();

  const onSubmit = async (values: { email: string; password: string }) => {
    setServerError(null);
    try {
      await login(values.email, values.password, 'employer');
      router.push(takeReturnTo('/employer'));
    } catch (err) {
      setServerError(err instanceof ApiError && err.message ? err.message : t('login.error'));
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader maxWidth="sm" backHref="/international" backLabel={t('employer.backToHire')} />
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm rounded-lg border border-border bg-white p-8">
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-brand-light text-brand-dark">
            <Globe2 className="h-5 w-5" aria-hidden />
          </span>
          <h1 className="mt-4 text-lg font-semibold text-ink">{t('employer.login.title')}</h1>
          <p className="mt-1 text-sm text-ink/60">{t('employer.login.subtitle')}</p>

          <form onSubmit={handleSubmit(onSubmit)} className="mt-6 space-y-4">
            <div>
              <Label htmlFor="email">{t('login.email')}</Label>
              <Input id="email" type="email" autoComplete="email" {...register('email', { required: true })} />
            </div>
            <div>
              <Label htmlFor="password">{t('login.password')}</Label>
              <PasswordInput id="password" autoComplete="current-password" {...register('password', { required: true })} />
              <div className="mt-1.5 text-right">
                <Link href="/forgot-password?for=employer" className="text-xs font-medium text-brand-dark hover:underline">
                  {t('passwordReset.forgotLink')}
                </Link>
              </div>
            </div>
            {serverError && (
              <div>
                <p role="alert" className="text-sm text-danger">
                  {serverError}
                </p>
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
            <p className="text-center text-sm text-ink/60">
              {t('employer.login.noAccount')}{' '}
              <Link href="/employer/register" className="font-medium text-brand-dark hover:underline">
                {t('employer.login.register')}
              </Link>
            </p>
          </form>
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}
