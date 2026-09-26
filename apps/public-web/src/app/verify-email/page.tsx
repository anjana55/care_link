'use client';

import { Suspense, useEffect, useState } from 'react';
import { useSearchParams, useRouter } from 'next/navigation';
import Link from 'next/link';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useAuth } from '@/lib/api/auth-context';
import { api, type Tokens } from '@/lib/api/client';

function VerifyEmailInner() {
  const { t } = useTranslation();
  const router = useRouter();
  const { applyTokens } = useAuth();
  const searchParams = useSearchParams();
  const token = searchParams.get('token');

  const [status, setStatus] = useState<'verifying' | 'success' | 'error'>('verifying');

  useEffect(() => {
    if (!token) {
      setStatus('error');
      return;
    }
    api
      .post<Tokens>('/auth/verify-email', { token })
      .then((tokens) => {
        applyTokens(tokens);
        setStatus('success');
        setTimeout(() => router.push('/'), 1200);
      })
      .catch(() => setStatus('error'));
    // Only run once, on mount - token comes from the URL and doesn't change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

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
  );
}

export default function VerifyEmailPage() {
  return (
    <Suspense fallback={null}>
      <VerifyEmailInner />
    </Suspense>
  );
}
