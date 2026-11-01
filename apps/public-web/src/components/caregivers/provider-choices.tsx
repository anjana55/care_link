'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/i18n';
import { api, ApiError } from '@/lib/api/client';
import { hardNavigate } from '@/lib/navigation';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';

const PROVIDERS = ['GOOGLE', 'MICROSOFT', 'FACEBOOK'] as const;
type Provider = (typeof PROVIDERS)[number];

/**
 * How the caregiver will sign in, offered once the registration form is
 * accepted (and after a claim code): a provider, or an email address and
 * password.
 *
 * The provider buttons: *
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
  email: formEmail,
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
  /** The address from the registration form, offered for the email-and-password sign-in. */
  email?: string;
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
      hardNavigate(url);
    } catch (err) {
      setPending(null);
      setError(err instanceof ApiError ? err.message : t('caregiverSignup.providerError'));
    }
  };

  const expiry = (
    <>
      {expired && <p className="mt-3 text-sm text-danger">{expiredMessage ?? t('caregiverSignup.tokenExpired')}</p>}
      {!expired && (
        <p className="mt-3 text-xs text-ink/40" aria-live="polite">
          {t('caregiverSignup.linkExpiresIn')} {Math.ceil(secondsLeft / 60)} {t('caregiverSignup.minutes')}
        </p>
      )}
    </>
  );

  // With no provider switched on, email and password is the way: no button to open it.
  if (available.length === 0) {
    return (
      <div>
        <EmailPasswordChoice pendingToken={pendingToken} initialEmail={formEmail} disabled={expired} startOpen />
        {expiry}
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

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <p className="my-3 text-center text-xs uppercase tracking-wide text-ink/40">{t('caregiverSignup.or')}</p>
      <EmailPasswordChoice pendingToken={pendingToken} initialEmail={formEmail} disabled={expired || pending !== null} />

      {expiry}
    </div>
  );
}

/**
 * Email and password instead of a provider. Set once with the same pending
 * token; the address is then confirmed by the usual verification link (unless
 * it is one a provider already verified), and from then on the caregiver signs
 * in with it on the caregiver sign-in page.
 */
function EmailPasswordChoice({
  pendingToken,
  initialEmail,
  disabled,
  startOpen = false,
}: {
  pendingToken: string;
  initialEmail?: string;
  disabled: boolean;
  startOpen?: boolean;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(startOpen);
  const [email, setEmail] = useState(initialEmail ?? '');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState<{ email: string; verificationSent: boolean } | null>(null);

  if (done) {
    return (
      <div role="status" className="rounded border border-brand/30 bg-brand-light p-4">
        <p className="text-sm font-semibold text-ink">{done.verificationSent ? t('caregiverSignup.checkEmailTitle') : t('caregiverSignup.passwordSet', { email: done.email })}</p>
        {done.verificationSent && <p className="mt-1 text-sm text-ink/70">{t('caregiverSignup.checkEmailBody', { email: done.email })}</p>}
        <Link href="/caregiver/login" className="mt-3 inline-block text-sm font-medium text-brand-dark hover:underline">
          {t('caregiverSignup.goToSignIn')}
        </Link>
      </div>
    );
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        className="flex w-full items-center justify-center rounded border border-border bg-white px-4 py-3 text-sm font-medium text-ink transition-colors hover:border-brand hover:bg-brand-light disabled:cursor-not-allowed disabled:opacity-60"
      >
        {t('caregiverSignup.emailPasswordButton')}
      </button>
    );
  }

  const submit = async () => {
    setProblem(null);
    const address = email.trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(address)) return setProblem(t('register.validation.email'));
    if (password.length < 8) return setProblem(t('register.validation.password'));
    if (password !== confirm) return setProblem(t('register.validation.passwordMismatch'));
    setSubmitting(true);
    try {
      setDone(await api.post<{ email: string; verificationSent: boolean }>('/auth/register-caregiver/unified/password', { pendingToken, email: address, password }));
    } catch (err) {
      setProblem(err instanceof ApiError && err.message ? err.message : t('caregiverSignup.passwordError'));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <form
      className="space-y-3 rounded border border-border p-4"
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        if (!submitting && !disabled) void submit();
      }}
    >
      <p className="text-sm font-semibold text-ink">{t('caregiverSignup.emailPasswordTitle')}</p>
      <div>
        <Label htmlFor="signup-email">{t('login.email')}</Label>
        <Input id="signup-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} />
      </div>
      <div>
        <Label htmlFor="signup-password">{t('login.password')}</Label>
        <PasswordInput id="signup-password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
        <p className="mt-1 text-xs text-ink/50">{t('caregiverSignup.passwordHint')}</p>
      </div>
      <div>
        <Label htmlFor="signup-confirm">{t('register.confirmPassword')}</Label>
        <PasswordInput id="signup-confirm" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} />
      </div>
      {problem && (
        <p role="alert" className="text-sm text-danger">
          {problem}
        </p>
      )}
      <Button type="submit" className="w-full" disabled={submitting || disabled}>
        {submitting ? t('common.loading') : t('caregiverSignup.createSignIn')}
      </Button>
    </form>
  );
}
