'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input, Label, RequiredLegend } from '@/components/ui/input';
import { AuthHeader } from '@/components/layout/brand-mark';
import { useWhatsappConfig } from '@/lib/hooks/use-whatsapp';

export default function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
  const { data: whatsapp } = useWhatsappConfig();
  const [email, setEmail] = useState('admin@care-platform.local');
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

        <p className="mt-4 text-center text-xs text-ink/40">
          admin@care-platform.local · staff@care-platform.local · verifier@care-platform.local · selfregistered@care-platform.local — password ChangeMe123!
        </p>

        {whatsapp?.caregiver.login && (
          <p className="mt-4 text-center text-sm text-ink/60">
            {t('whatsapp.login.noEmail')}{' '}
            <Link href="/login/whatsapp" className="font-medium text-brand-dark hover:underline">
              {t('whatsapp.login.useWhatsapp')}
            </Link>
          </p>
        )}

        <p className="mt-6 text-center text-sm text-ink/60">
          {t('login.newCaregiver')}{' '}
          <Link href="/register" className="font-medium text-brand-dark hover:underline">
            {t('register.title')}
          </Link>
        </p>
        </div>
      </div>
    </div>
  );
}
