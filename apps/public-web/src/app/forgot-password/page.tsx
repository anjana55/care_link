'use client';

import { Suspense, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { MailCheck } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { api, ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { loginPathFor } from '@/lib/login-path';

/**
 * "Forgot password?" for clients, caregivers and employers. The answer is the
 * same whether or not the address has an account, so this can't be used to
 * find out who is registered.
 */
function ForgotPasswordInner() {
  const { t } = useTranslation();
  const who = useSearchParams().get('for');
  const [email, setEmail] = useState('');
  const [pending, setPending] = useState(false);
  const [sent, setSent] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const res = await api.post<{ message: string }>('/auth/forgot-password', { email: email.trim() });
      setSent(res.message);
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : t('passwordReset.requestError'));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader maxWidth="sm" />
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm rounded-lg border border-border bg-white p-8">
          {sent ? (
            <div className="text-center">
              <MailCheck size={40} className="mx-auto mb-4 text-brand" aria-hidden />
              <h1 className="mb-2 text-lg font-semibold text-ink">{t('passwordReset.sentTitle')}</h1>
              <p role="status" className="text-sm text-ink/70">
                {sent}
              </p>
              <p className="mt-3 text-xs text-ink/50">{t('passwordReset.sentHint')}</p>
              <Link href={loginPathFor(who)} className="mt-6 inline-block text-sm font-medium text-brand-dark hover:underline">
                {t('passwordReset.backToLogin')}
              </Link>
            </div>
          ) : (
            <>
              <h1 className="text-lg font-semibold text-ink">{t('passwordReset.forgotTitle')}</h1>
              <p className="mt-1 text-sm text-ink/60">{t('passwordReset.forgotBody')}</p>
              <form
                className="mt-6 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (email.trim() && !pending) void submit();
                }}
              >
                <div>
                  <Label htmlFor="email">{t('login.email')}</Label>
                  <Input id="email" type="email" autoComplete="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                {error && (
                  <p role="alert" className="text-sm text-danger">
                    {error}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={!email.trim() || pending}>
                  {pending ? t('common.loading') : t('passwordReset.sendLink')}
                </Button>
                <p className="text-center text-xs text-ink/50">{t('passwordReset.whatsappHint')}</p>
                <p className="text-center text-sm">
                  <Link href={loginPathFor(who)} className="font-medium text-brand-dark hover:underline">
                    {t('passwordReset.backToLogin')}
                  </Link>
                </p>
              </form>
            </>
          )}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}

export default function ForgotPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ForgotPasswordInner />
    </Suspense>
  );
}
