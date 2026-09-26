'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth, postLoginPath } from '@/lib/api/auth-context';
import { api, ApiError, type Tokens } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';

function VerifyEmailInner() {
  const { t } = useTranslation();
  const router = useRouter();
  const { applyTokens } = useAuth();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');
  const [resendEmail, setResendEmail] = useState('');
  const [resendMessage, setResendMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      setStatus('error');
      return;
    }
    api
      .post<Tokens>('/auth/verify-email', { token })
      .then((tokens) => {
        const user = applyTokens(tokens);
        setStatus('success');
        setTimeout(() => router.push(user ? postLoginPath(user) : '/login'), 1200);
      })
      .catch(() => setStatus('error'));
    // Only run once, on mount - token comes from the URL and doesn't change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  const resend = async () => {
    setResendMessage(null);
    try {
      const res = await api.post<{ message: string }>('/auth/resend-verification', { email: resendEmail });
      setResendMessage(res.message);
    } catch (err) {
      setResendMessage(err instanceof ApiError ? err.message : 'Something went wrong.');
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-white p-8 text-center">
        {status === 'verifying' && <p className="text-sm text-ink/60">{t('verifyEmail.verifying')}</p>}

        {status === 'success' && (
          <>
            <CheckCircle2 size={40} className="mx-auto mb-4 text-brand" />
            <h1 className="mb-2 text-lg font-semibold text-ink">{t('verifyEmail.successTitle')}</h1>
            <p className="text-sm text-ink/60">{t('verifyEmail.successBody')}</p>
          </>
        )}

        {status === 'error' && (
          <>
            <XCircle size={40} className="mx-auto mb-4 text-danger" />
            <h1 className="mb-2 text-lg font-semibold text-ink">{t('verifyEmail.errorTitle')}</h1>
            <p className="mb-5 text-sm text-ink/60">{t('verifyEmail.errorBody')}</p>

            <div className="mb-4 text-left">
              <Label htmlFor="resendEmail">{t('verifyEmail.resendLabel')}</Label>
              <Input id="resendEmail" type="email" value={resendEmail} onChange={(e) => setResendEmail(e.target.value)} />
            </div>
            <Button className="w-full" disabled={!resendEmail} onClick={resend}>
              {t('verifyEmail.resendButton')}
            </Button>
            {resendMessage && <p className="mt-3 text-xs text-ink/60">{resendMessage}</p>}

            <Link href="/login" className="mt-5 block text-sm font-medium text-brand-dark hover:underline">
              {t('verifyEmail.backToLogin')}
            </Link>
          </>
        )}
      </div>
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
