'use client';

import { useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { api, ApiError } from '@/lib/api/client';
import { useSocialProviders, type SocialProviderName } from '@/lib/hooks/use-social-providers';

const ORDER: SocialProviderName[] = ['GOOGLE', 'MICROSOFT', 'FACEBOOK'];

/**
 * Where the browser keeps the sign-in nonce between leaving for the provider and
 * coming back. sessionStorage rather than localStorage: it is per-tab and dies
 * with it, so a nonce can never outlive the attempt that made it.
 */
export const LOGIN_NONCE_KEY = 'care-caregiver-social-login-nonce';

function makeNonce() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * "Continue with Google / Microsoft / Facebook" for a caregiver who has already
 * registered.
 *
 * Renders nothing - not even a divider - when no provider is configured, so the
 * email form below it is never preceded by an empty section. `children` is the
 * "or sign in with email" divider and is only shown when there are buttons for
 * it to divide.
 */
export function SocialLoginButtons({ children }: { children?: React.ReactNode }) {
  const { t } = useTranslation();
  const { data: providers } = useSocialProviders();
  const [pending, setPending] = useState<SocialProviderName | null>(null);
  const [error, setError] = useState<string | null>(null);

  const available = ORDER.filter((p) => providers?.[p]);
  if (available.length === 0) return null;

  const start = async (provider: SocialProviderName) => {
    setPending(provider);
    setError(null);
    try {
      const nonce = makeNonce();
      window.sessionStorage.setItem(LOGIN_NONCE_KEY, nonce);
      const { url } = await api.get<{ url: string }>(`/auth/social/${provider.toLowerCase()}/login-url`, { nonce });
      // A full navigation: the caregiver is leaving this app for the provider.
      window.location.assign(url);
    } catch (err) {
      setPending(null);
      setError(err instanceof ApiError ? err.message : t('caregiverSignup.providerError'));
    }
  };

  return (
    <div>
      <div className="grid gap-2">
        {available.map((provider) => (
          <button
            key={provider}
            type="button"
            onClick={() => start(provider)}
            disabled={pending !== null}
            className="flex items-center justify-center gap-2 rounded border border-border bg-white px-4 py-2.5 text-sm font-medium text-ink transition-colors hover:border-brand hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending === provider ? t('common.loading') : t(`caregiverSignup.providers.${provider}`)}
          </button>
        ))}
      </div>
      {error && (
        <p role="alert" className="mt-3 text-sm text-danger">
          {error}
        </p>
      )}
      {children}
    </div>
  );
}
