'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import type { PendingLinkGrant, SocialProviderAvailability } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { api, ApiError } from '@/lib/api/client';
import { hardNavigate } from '@/lib/navigation';
import { rememberReturnTo } from '@/lib/return-to';

type Provider = 'GOOGLE' | 'MICROSOFT' | 'FACEBOOK';
const ORDER: Provider[] = ['GOOGLE', 'MICROSOFT', 'FACEBOOK'];
const NAMES: Record<Provider, string> = { GOOGLE: 'Google', MICROSOFT: 'Microsoft', FACEBOOK: 'Facebook' };
const PATH = '/account/sign-in';

/** GET /me/sign-in-methods. */
interface SignInMethods {
  email: string | null;
  password: boolean;
  linked: Provider[];
  providers: SocialProviderAvailability;
}

/**
 * My account › Sign-in methods: how the client signs in, and linking Google,
 * Microsoft or Facebook to the account they already have - the same round
 * trip as at registration (an account with the same address, if theirs has
 * one). They come back here afterwards, signed in, with it listed as linked;
 * from then on it signs them in, on the website and in the app.
 */
export default function SignInMethodsPage() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useQuery({ queryKey: ['me', 'sign-in-methods'], queryFn: () => api.get<SignInMethods>('/me/sign-in-methods') });
  const [pending, setPending] = useState<Provider | null>(null);
  const [error, setError] = useState<string | null>(null);

  const link = async (provider: Provider) => {
    setPending(provider);
    setError(null);
    try {
      const grant = await api.post<PendingLinkGrant>('/me/social/link-grant');
      const { url } = await api.get<{ url: string }>(`/auth/social/${provider.toLowerCase()}/authorize-url`, { token: grant.pendingToken });
      // Back here after the provider, once the callback page has signed them in again.
      rememberReturnTo(PATH);
      hardNavigate(url);
    } catch (err) {
      setPending(null);
      setError(err instanceof ApiError && err.message ? err.message : t('account.signIn.error'));
    }
  };

  const available = data ? ORDER.filter((p) => data.providers[p] || data.linked.includes(p)) : [];

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">{t('account.signIn.title')}</h1>
        <p className="mt-1 text-sm text-ink/60">{t('account.signIn.subtitle')}</p>
      </div>
      {isLoading && <p className="text-sm text-ink/60">{t('common.loading')}</p>}
      {isError && (
        <p role="alert" className="text-sm text-danger">
          {t('account.signIn.error')}
        </p>
      )}
      {data && (
        <>
          <section className="rounded-lg border border-border bg-white p-5">
            <h2 className="text-sm font-semibold text-ink">{t('account.signIn.emailPassword')}</h2>
            <p className="mt-1 text-sm text-ink/70">{data.password && data.email ? t('account.signIn.on', { email: data.email }) : t('account.signIn.off')}</p>
          </section>

          <section className="rounded-lg border border-border bg-white p-5">
            <h2 className="text-sm font-semibold text-ink">{t('account.signIn.providers')}</h2>
            {available.length === 0 ? (
              <p className="mt-1 text-sm text-ink/60">{t('account.signIn.none')}</p>
            ) : (
              <>
                <p className="mt-1 text-sm text-ink/60">
                  {data.email ? t('account.signIn.providersHint', { email: data.email }) : t('account.signIn.providersHintNoEmail')}
                </p>
                <ul className="mt-4 divide-y divide-border">
                  {available.map((provider) => (
                    <li key={provider} className="flex items-center justify-between gap-3 py-3">
                      <span className="text-sm font-medium text-ink">{NAMES[provider]}</span>
                      {data.linked.includes(provider) ? (
                        <span className="rounded-full bg-brand-light px-3 py-1 text-xs font-semibold text-brand-dark">{t('account.signIn.linked')}</span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void link(provider)}
                          disabled={pending !== null}
                          aria-label={`${t('account.signIn.link')} ${NAMES[provider]}`}
                          className="rounded border border-border px-3 py-1.5 text-sm font-medium text-ink hover:border-brand hover:bg-brand-light disabled:opacity-60"
                        >
                          {pending === provider ? t('common.loading') : t('account.signIn.link')}
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </>
            )}
            {error && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {error}
              </p>
            )}
          </section>
        </>
      )}
    </div>
  );
}
