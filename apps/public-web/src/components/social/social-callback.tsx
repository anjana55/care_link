'use client';

import { Suspense, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import { useTranslation } from '@/lib/i18n';
import { useAuth } from '@/lib/api/auth-context';
import { api, ApiError, type Tokens } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { LOGIN_NONCE_KEY } from '@/components/caregivers/social-login-buttons';
import { hardNavigate } from '@/lib/navigation';
import { takeReturnTo } from '@/lib/return-to';

export type SocialSide = 'caregiver' | 'client';

/**
 * Where the provider sends a caregiver (/caregiver/social/callback) or a
 * client (/social/callback) back to.
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
  not_registered: 'caregiverSignup.errors.notRegistered',
  account_disabled: 'caregiverSignup.errors.accountDisabled',
  wrong_portal: 'socialSignIn.errors.wrongPortalCaregiver',
};
/** A client's own wording where it differs from a caregiver's. */
const CLIENT_ERRORS: Record<string, string> = {
  ...ERRORS,
  not_registered: 'socialSignIn.errors.notRegistered',
  email_mismatch: 'socialSignIn.errors.emailMismatch',
  wrong_portal: 'socialSignIn.errors.wrongPortalClient',
};

function CallbackInner({ side }: { side: SocialSide }) {
  const { t } = useTranslation();
  const { applyTokens } = useAuth();
  const params = useSearchParams();
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const isLogin = params.get('flow') === 'login';
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
      setErrorCode(failure);
      setError(t((side === 'client' ? CLIENT_ERRORS : ERRORS)[failure] ?? 'caregiverSignup.errors.generic'));
      return;
    }
    if (!code) {
      setError(t('caregiverSignup.errors.invalidRequest'));
      return;
    }

    // A sign-in must come back to the browser tab that started it. The nonce was
    // generated there, went through the provider inside the signed state, and
    // is compared here before the code is spent - so a callback link opened by
    // someone else cannot sign them in as the person who started the attempt.
    if (isLogin) {
      const expected = window.sessionStorage.getItem(LOGIN_NONCE_KEY);
      window.sessionStorage.removeItem(LOGIN_NONCE_KEY);
      if (!expected || expected !== params.get('nonce')) {
        setError(t('caregiverSignup.errors.stateMismatch'));
        return;
      }
    }

    api
      .post<Tokens>('/auth/social/exchange', { code })
      .then((tokens) => {
        const user = applyTokens(tokens);
        // The role check is the same one the WhatsApp page does. A token that
        // is valid but not this side's would send them to a page they have
        // no claim on. A client goes back to where they set out from (the
        // caregiver they were contacting, or Sign-in methods after linking).
        if (side === 'client') hardNavigate(user?.role === 'PATIENT_GUARDIAN' ? takeReturnTo('/find') : '/login');
        else hardNavigate(user?.role === 'CAREGIVER' ? '/caregiver/dashboard' : '/caregiver/login');
      })
      .catch((err) => {
        setError(err instanceof ApiError ? t('caregiverSignup.errors.exchangeFailed') : t('caregiverSignup.errors.generic'));
      });
  }, [params, applyTokens, t, isLogin, side]);

  if (error && side === 'client') {
    return (
      <div className="rounded-lg border border-border bg-white p-6 text-center">
        <h1 className="mb-2 text-lg font-semibold text-ink">{t('caregiverSignup.callbackTitle')}</h1>
        <p className="mb-5 text-sm text-danger">{error}</p>
        <div className="flex flex-col gap-2">
          {errorCode === 'wrong_portal' && (
            <Link href="/caregiver/login">
              <Button className="w-full">{t('socialSignIn.otherSignIn.caregiver')}</Button>
            </Link>
          )}
          {errorCode === 'not_registered' && (
            <Link href="/register">
              <Button className="w-full">{t('socialSignIn.register')}</Button>
            </Link>
          )}
          {/* Linking failed: they are signed in already, or will confirm by email - either way, back to where they came from. */}
          {!isLogin && (
            <Link href="/account/sign-in">
              <Button variant="secondary" className="w-full">{t('socialSignIn.signInMethods')}</Button>
            </Link>
          )}
          <Link href="/login">
            <Button variant={errorCode === 'not_registered' || errorCode === 'wrong_portal' ? 'secondary' : 'primary'} className="w-full">
              {t('socialSignIn.backToSignIn')}
            </Button>
          </Link>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="rounded-lg border border-border bg-white p-6 text-center">
        <h1 className="mb-2 text-lg font-semibold text-ink">{t('caregiverSignup.callbackTitle')}</h1>
        <p className="mb-5 text-sm text-danger">{error}</p>
        {isLogin ? (
          <div className="flex flex-col gap-2">
            {errorCode === 'wrong_portal' && (
              <Link href="/login">
                <Button className="w-full">{t('socialSignIn.otherSignIn.client')}</Button>
              </Link>
            )}
            {errorCode === 'not_registered' && (
              <Link href="/caregiver/signup">
                <Button className="w-full">{t('caregiverSignup.registerInstead')}</Button>
              </Link>
            )}
            <Link href="/caregiver/login">
              <Button variant={errorCode === 'not_registered' ? 'secondary' : 'primary'} className="w-full">
                {t('caregiverSignup.backToLogin')}
              </Button>
            </Link>
          </div>
        ) : (
          // The details are already saved by the time a provider step fails, so
          // registering again would only hit "already exists". Finishing the
          // saved registration is the way forward; a fresh form is the fallback.
          <div className="flex flex-col gap-2">
            <Link href="/caregiver/claim">
              <Button className="w-full">{t('caregiverClaim.finishCta')}</Button>
            </Link>
            <Link href="/caregiver/signup">
              <Button variant="secondary" className="w-full">{t('caregiverSignup.backToSignup')}</Button>
            </Link>
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="py-16 text-center">
      <p className="text-sm text-ink/60">{t('common.loading')}</p>
    </div>
  );
}

export function SocialCallback({ side }: { side: SocialSide }) {
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
          <CallbackInner side={side} />
        </Suspense>
      </main>
    </div>
  );
}