'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { postLoginPath, useAuth } from '@/lib/api/auth-context';
import { api, ApiError, type Tokens } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { takeReturnTo } from '@/lib/return-to';

function VerifyEmailInner() {
  const { t } = useTranslation();
  const router = useRouter();
  const { applyTokens } = useAuth();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'verifying' | 'success' | 'already' | 'error'>('verifying');
  const [alreadyRole, setAlreadyRole] = useState<string | null>(null);
  const [resendEmail, setResendEmail] = useState('');
  const [resendState, setResendState] = useState<{ pending: boolean; message: string | null }>({ pending: false, message: null });

  // A link is single use: use it once even when the effect runs twice (React
  // dev mode), or the second call finds it used.
  const used = useRef(false);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      return;
    }
    if (used.current) return;
    used.current = true;
    api
      .post<Tokens | { alreadyVerified: true; role: string }>('/auth/verify-email', { token })
      .then((res) => {
        // The link was opened before (a second click, or the mail app's link
        // preview got there first). The address is verified - say so, and
        // send them to sign in rather than reporting a failure.
        if ('alreadyVerified' in res) {
          setAlreadyRole(res.role);
          setStatus('already');
          return;
        }
        const user = applyTokens(res);
        setStatus('success');
        // A client returns to where they left off; a caregiver goes on to
        // their own area.
        const next = !user ? '/login' : user.role === 'PATIENT_GUARDIAN' ? takeReturnTo('/') : postLoginPath(user);
        setTimeout(() => router.push(next), 1200);
      })
      .catch(() => setStatus('error'));
    // Only run once, on mount - token comes from the URL and doesn't change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const resend = async () => {
    setResendState({ pending: true, message: null });
    try {
      const res = await api.post<{ message: string }>('/auth/resend-verification', { email: resendEmail.trim() });
      setResendState({ pending: false, message: res.message });
    } catch (err) {
      setResendState({ pending: false, message: err instanceof ApiError && err.message ? err.message : t('verifyEmail.resendError') });
    }
  };
  const loginHref = alreadyRole === 'CAREGIVER' ? '/caregiver/login' : '/login';

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader maxWidth="sm" />

      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm rounded-lg border border-border bg-white p-8 text-center">
        {status === 'verifying' && <p className="text-sm text-ink/60">{t('verifyEmail.verifying')}</p>}

        {status === 'success' && (
          <>
            <CheckCircle2 size={40} className="mx-auto mb-4 text-brand" />
            <h1 className="mb-2 text-lg font-semibold text-ink">{t('verifyEmail.successTitle')}</h1>
            <p className="text-sm text-ink/60">{t('verifyEmail.successBody')}</p>
          </>
        )}

        {status === 'already' && (
          <>
            <CheckCircle2 size={40} className="mx-auto mb-4 text-brand" />
            <h1 className="mb-2 text-lg font-semibold text-ink">{t('verifyEmail.alreadyTitle')}</h1>
            <p className="mb-5 text-sm text-ink/60">{t('verifyEmail.alreadyBody')}</p>
            <Link href={loginHref} className="text-sm font-medium text-brand-dark hover:underline">
              {t('verifyEmail.goToLogin')}
            </Link>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle size={40} className="mx-auto mb-4 text-danger" />
            <h1 className="mb-2 text-lg font-semibold text-ink">{t('verifyEmail.errorTitle')}</h1>
            <p className="mb-5 text-sm text-ink/60">{t('verifyEmail.errorBody')}</p>
            <form
              className="mb-5 text-left"
              onSubmit={(e) => {
                e.preventDefault();
                if (resendEmail.trim() && !resendState.pending) void resend();
              }}
            >
              <Label htmlFor="resendEmail">{t('verifyEmail.resendLabel')}</Label>
              <Input id="resendEmail" type="email" autoComplete="email" value={resendEmail} onChange={(e) => setResendEmail(e.target.value)} />
              <Button type="submit" className="mt-3 w-full" disabled={!resendEmail.trim() || resendState.pending}>
                {resendState.pending ? t('common.loading') : t('verifyEmail.resendButton')}
              </Button>
              {resendState.message && (
                <p role="status" className="mt-3 text-xs text-ink/60">
                  {resendState.message}
                </p>
              )}
            </form>
            <div className="flex flex-col gap-2">
              <Link href="/login" className="text-sm font-medium text-brand-dark hover:underline">
                {t('verifyEmail.goToLogin')}
              </Link>
              <Link href="/" className="text-sm text-ink/50 hover:text-ink/80">
                {t('verifyEmail.backHome')}
              </Link>
            </div>
          </>
        )}
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailInner />
    </Suspense>
  );
}
