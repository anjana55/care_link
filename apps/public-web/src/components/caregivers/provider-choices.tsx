'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { api, ApiError } from '@/lib/api/client';

const PROVIDERS = ['GOOGLE', 'MICROSOFT', 'FACEBOOK'] as const;
type Provider = (typeof PROVIDERS)[number];

/**
 * The provider buttons offered once the registration form is accepted.
 *
 * Each click asks the API for the provider's consent URL and then navigates.
 * It does *not* point straight at the API route: a fetch that followed a 302
 * to Google would try to read Google's login page as if it were our JSON,
 * which fails on CORS with an opaque error and nothing for the caregiver to act
 * on. Asking first keeps the reason for a refusal ours.
 */
export function ProviderChoices({
  pendingToken,
  providers,
  expiresInSeconds,
  expiredMessage,
}: {
  pendingToken: string;
  providers: Record<Provider, boolean>;
  /** Surfaced as a countdown, because the token that authorises this step expires. */
  expiresInSeconds: number;
  /**
   * What to tell someone whose link ran out. The registration page and the
   * finish-your-account page give different advice, but neither should send
   * them back to register again: their details are already saved.
   */
  expiredMessage?: string;
}) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(expiresInSeconds);

  useEffect(() => {
    const timer = setInterval(() => setSecondsLeft((s) => Math.max(0, s - 1)), 1000);
    return () => clearInterval(timer);
  }, []);

  const available = PROVIDERS.filter((p) => providers[p]);
  const expired = secondsLeft === 0;

  const start = async (provider: Provider) => {
    setPending(provider);
    setError(null);
    try {
      const { url } = await api.get<{ url: string }>(
        `/auth/social/${provider.toLowerCase()}/authorize-url`,
        { token: pendingToken },
      );
      // A full navigation, not a client-side route change: the caregiver is
      // leaving this app for the provider and coming back, and this container
      // holds no route for their return.
      window.location.assign(url);
    } catch (err) {
      setPending(null);
      setError(err instanceof ApiError ? err.message : t('caregiverSignup.providerError'));
    }
  };

  if (available.length === 0) {
    return (
      <div className="rounded border border-border bg-paper p-4">
        <p className="text-sm text-ink/70">{t('caregiverSignup.noProviders')}</p>
      </div>
    );
  }

  return (
    <div>
      <p className="mb-3 text-sm text-ink/60">{t('caregiverSignup.chooseProvider')}</p>

      <div className="grid gap-2">
        {available.map((provider) => (
          <button
            key={provider}
            type="button"
            onClick={() => start(provider)}
            disabled={pending !== null || expired}
            className="flex items-center justify-center gap-2 rounded border border-border bg-white px-4 py-3 text-sm font-medium text-ink transition-colors hover:border-brand hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-60"
          >
            {pending === provider ? t('common.loading') : t(`caregiverSignup.providers.${provider}`)}
          </button>
        ))}
      </div>

      {expired && <p className="mt-3 text-sm text-danger">{expiredMessage ?? t('caregiverSignup.tokenExpired')}</p>}

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      {!expired && (
        <p className="mt-3 text-xs text-ink/40" aria-live="polite">
          {t('caregiverSignup.linkExpiresIn')} {Math.ceil(secondsLeft / 60)} {t('caregiverSignup.minutes')}
        </p>
      )}
    </div>
  );
}