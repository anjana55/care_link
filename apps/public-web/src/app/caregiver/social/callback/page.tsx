'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslation } from '@/lib/i18n';
import { useAuth } from '@/lib/api/auth-context';
import { api, ApiError, type Tokens } from '@/lib/api/client';
import { Button } from '@/components/ui/button';

/**
 * Where the provider sends the caregiver back to.
 *
 * The API has already linked the provider identity by the time this page
 * loads; all that is left is to trade the one-time code for a session. That
 * happens over POST on purpose - the code is a bearer value, and a code that
 * reached the session through a URL would already have passed through browser
 * history, the Referer header and the server's access log.
 *
 * A full navigation afterwards rather than a client-side push, because the
 * destination reads the session out of localStorage on mount.
 */

/**
 * Error codes the API can put in `?error=`, each with a sentence to show.
 * Anything unrecognised falls back to the generic message rather than being
 * echoed back - the value came from a query string and must never be rendered.
 */
const ERRORS: Record<string, string> = {
  declined: 'caregiverSignup.errors.declined',
  invalid_request: 'caregiverSignup.errors.invalidRequest',
  expired: 'caregiverSignup.errors.expired',
  email_mismatch: 'caregiverSignup.errors.emailMismatch',
  already_linked: 'caregiverSignup.errors.alreadyLinked',
  email_taken: 'caregiverSignup.errors.emailTaken',
  registration_gone: 'caregiverSignup.errors.registrationGone',
  provider_error: 'caregiverSignup.errors.providerError',
};

function CallbackInner() {
  const { t } = useTranslation();
  const { applyTokens } = useAuth();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  // React 18 StrictMode double-invokes effects in development, and this effect
  // spends the code. Without the guard the second run would present the same
  // code as already used and show a spurious failure on a working sign-in.
  const spent = useRef(false);

  useEffect(() => {
    if (spent.current) return;
    spent.current = true;

    const code = params.get('code');
    const failure = params.get('error');
    if (failure) {
      setError(t(ERRORS[failure] ?? 'caregiverSignup.errors.generic'));
      return;
    }
    if (!code) {
      setError(t('caregiverSignup.errors.invalidRequest'));
      return;
    }

    api
      .post<Tokens>('/auth/social/exchange', { code })
      .then((tokens) => {
        const user = applyTokens(tokens);
        // The role check is the same one the WhatsApp page does. A token that
        // is valid but not a caregiver's would send them to a page they have
        // no claim on.
        window.location.assign(user?.role === 'CAREGIVER' ? '/caregiver/dashboard' : '/caregiver/login');
      })
      .catch((err) => {
        setError(err instanceof ApiError ? t('caregiverSignup.errors.exchangeFailed') : t('caregiverSignup.errors.generic'));
      });
  }, [params, applyTokens, t]);

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-white p-6 text-center">
        <h1 className="mb-2 text-lg font-semibold text-ink">{t('caregiverSignup.callbackTitle')}</h1>
        <p className="mb-5 text-sm text-danger">{error}</p>
        <Link href="/caregiver/signup">
          <Button>{t('caregiverSignup.backToSignup')}</Button>
        </Link>
      </div>
    );
  }

  return (
    <div className="py-16 text-center">
      <p className="text-sm text-ink/60">{t('common.loading')}</p>
    </div>
  );
}

export default function CaregiverSocialCallbackPage() {
  const { t } = useTranslation();

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <main className="mx-auto w-full max-w-md flex-1 px-4 py-16">
        {/* useSearchParams needs a Suspense boundary during the build, where
            there is no request to read the query string from. */}
        <Suspense
          fallback={
            <div className="py-16 text-center">
              <p className="text-sm text-ink/60">{t('common.loading')}</p>
            </div>
          }
        >
          <CallbackInner />
        </Suspense>
      </main>
    </div>
  );
}