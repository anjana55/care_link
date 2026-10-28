'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { api, ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';
import { loginPathFor } from '@/lib/login-path';

type LinkState = { status: 'checking' } | { status: 'invalid' } | { status: 'ready'; role: string; firstPassword: boolean; email: string | null } | { status: 'done'; role: string };

const MIN_LENGTH = 8;

/**
 * Opened from the password email. Checks the link first, so an expired one is
 * said up front rather than after typing; then sets the password. It does not
 * sign anyone in - they sign in with the new password, on their own page.
 */
function ResetPasswordInner() {
  const { t } = useTranslation();
  const token = useSearchParams().get('token') ?? '';
  const [state, setState] = useState<LinkState>({ status: 'checking' });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setState({ status: 'invalid' });
      return;
    }
    api
      .post<{ role: string; firstPassword: boolean; email: string | null }>('/auth/reset-password/check', { token })
      .then((res) => setState({ status: 'ready', role: res.role, firstPassword: res.firstPassword, email: res.email }))
      .catch(() => setState({ status: 'invalid' }));
  }, [token]);

  const tooShort = password.length > 0 && password.length < MIN_LENGTH;
  const mismatch = confirm.length > 0 && confirm !== password;
  const canSubmit = password.length >= MIN_LENGTH && confirm === password && !pending;

  const submit = async () => {
    if (state.status !== 'ready') return;
    setPending(true);
    setError(null);
    try {
      const res = await api.post<{ role: string }>('/auth/reset-password', { token, newPassword: password });
      setState({ status: 'done', role: res.role });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setState({ status: 'invalid' });
      else setError(err instanceof ApiError && err.message ? err.message : t('passwordReset.resetError'));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader maxWidth="sm" />
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm rounded-lg border border-border bg-white p-8">
          {state.status === 'checking' && <p className="text-center text-sm text-ink/60">{t('common.loading')}</p>}

          {state.status === 'invalid' && (
            <div className="text-center">
              <XCircle size={40} className="mx-auto mb-4 text-danger" aria-hidden />
              <h1 className="mb-2 text-lg font-semibold text-ink">{t('passwordReset.invalidTitle')}</h1>
              <p className="text-sm text-ink/60">{t('passwordReset.invalidBody')}</p>
              <Link href="/forgot-password" className="mt-6 inline-block text-sm font-medium text-brand-dark hover:underline">
                {t('passwordReset.askAgain')}
              </Link>
            </div>
          )}

          {state.status === 'done' && (
            <div className="text-center">
              <CheckCircle2 size={40} className="mx-auto mb-4 text-brand" aria-hidden />
              <h1 className="mb-2 text-lg font-semibold text-ink">{t('passwordReset.doneTitle')}</h1>
              <p className="text-sm text-ink/60">{t('passwordReset.doneBody')}</p>
              <Link href={loginPathFor(state.role)} className="mt-6 inline-flex rounded-DEFAULT bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">
                {t('passwordReset.signIn')}
              </Link>
            </div>
          )}

          {state.status === 'ready' && (
            <>
              <h1 className="text-lg font-semibold text-ink">{state.firstPassword ? t('passwordReset.setTitle') : t('passwordReset.resetTitle')}</h1>
              <p className="mt-1 text-sm text-ink/60">{state.email ? t('passwordReset.forAccount', { email: state.email }) : t('passwordReset.chooseBody')}</p>
              <form
                className="mt-6 space-y-4"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (canSubmit) void submit();
                }}
              >
                {/* Lets password managers file the new password under the right account. */}
                {state.email && <input type="email" name="username" autoComplete="username" value={state.email} readOnly hidden />}
                <div>
                  <Label htmlFor="new-password">{t('passwordReset.newPassword')}</Label>
                  <PasswordInput id="new-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} required />
                  <p className={`mt-1 text-xs ${tooShort ? 'text-danger' : 'text-ink/50'}`}>{t('passwordReset.rule', { n: MIN_LENGTH })}</p>
                </div>
                <div>
                  <Label htmlFor="confirm-password">{t('passwordReset.confirmPassword')}</Label>
                  <PasswordInput id="confirm-password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} maxLength={128} required />
                  {mismatch && <p className="mt-1 text-xs text-danger">{t('passwordReset.mismatch')}</p>}
                </div>
                {error && (
                  <p role="alert" className="text-sm text-danger">
                    {error}
                  </p>
                )}
                <Button type="submit" className="w-full" disabled={!canSubmit}>
                  {pending ? t('common.loading') : t('passwordReset.save')}
                </Button>
                <p className="text-center text-xs text-ink/50">{t('passwordReset.signOutNote')}</p>
              </form>
            </>
          )}
        </div>
      </div>
      <SiteFooter />
    </div>
  );
}

export default function ResetPasswordPage() {
  return (
    <Suspense fallback={null}>
      <ResetPasswordInner />
    </Suspense>
  );
}
