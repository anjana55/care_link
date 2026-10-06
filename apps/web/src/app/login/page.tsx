'use client';

import { useState, FormEvent } from 'react';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input, Label, RequiredLegend } from '@/components/ui/input';
import { AuthHeader } from '@/components/layout/brand-mark';

export default function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await login(email, password);
    } catch (err) {
      // Surface the server's actual message. Swallowing it for a generic
      // "Incorrect email or password" made every failure look like a wrong
      // password - including a 400 from @IsEmail() rejecting the address,
      // which is what happens on a localhost/IP deployment where
      // setup.sh derives admin@<DOMAIN> and that domain has no dot in it.
      // The API already returns one message for both "no such user" and
      // "wrong password" (validateUser throws 'Invalid credentials' either
      // way), so this leaks nothing about which accounts exist.
      setError(err instanceof ApiError && err.message ? err.message : t('login.error'));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <AuthHeader />
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <h1 className="text-lg font-semibold text-ink">{t('login.title')}</h1>
            <p className="text-sm text-ink/60">{t('login.subtitle')}</p>
          </div>

        <form onSubmit={onSubmit} className="rounded-lg border border-border bg-white p-6">
          <RequiredLegend label={t('common.requiredField')} />
          <div className="mb-4">
            <Label htmlFor="email" required>{t('login.email')}</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="mb-5">
            <Label htmlFor="password" required>{t('login.password')}</Label>
            <Input
              id="password"
              type="password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
            />
          </div>
          {error && <p className="mb-4 text-sm text-danger">{error}</p>}
          <Button type="submit" className="w-full" disabled={loading}>
            {loading ? t('common.loading') : t('login.submit')}
          </Button>
        </form>

        {/*
          A plain <a>, not <Link>: caregiver sign-up is served by the
          public-web container, not this one. next/link would resolve it
          through this app's router as /staff/caregiver/join and render a 404.
        */}
        <p className="mt-6 text-center text-sm text-ink/60">
          {t('login.newCaregiver')}{' '}
          <a href="/caregiver/join" className="font-medium text-brand-dark hover:underline">
            {t('register.title')}
          </a>
        </p>

        {/*
          Always shown, so it says nothing about any account. This sign-in only
          accepts office staff (the API refuses everyone else with "Invalid
          credentials"), so a caregiver or client who landed here needs a way to
          their own sign-in that does not depend on being told why they were turned
          away. Plain <a>: those pages belong to the public site, not this app.
        */}
        <div className="mt-6 space-y-1 border-t border-border pt-4 text-center text-xs text-ink/50">
          <p>
            {t('login.caregiverPrompt')}{' '}
            <a href="/caregiver/login" className="font-medium text-brand-dark hover:underline">{t('login.caregiverLink')}</a>
          </p>
          <p>
            {t('login.clientPrompt')}{' '}
            <a href="/login" className="font-medium text-brand-dark hover:underline">{t('login.clientLink')}</a>
          </p>
        </div>
        </div>
      </div>
    </div>
  );
}
