'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/input';

export default function LoginPage() {
  const { t } = useTranslation();
  const { login } = useAuth();
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
      setError(err instanceof ApiError ? t('login.error') : 'Something went wrong. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-paper px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 flex flex-col items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded bg-brand text-base font-bold text-white">
            CP
          </div>
          <div className="text-center">
            <h1 className="text-lg font-semibold text-ink">{t('login.title')}</h1>
            <p className="text-sm text-ink/60">{t('login.subtitle')}</p>
          </div>
        </div>

        <form onSubmit={onSubmit} className="rounded-lg border border-border bg-white p-6">
          <div className="mb-4">
            <Label htmlFor="email">{t('login.email')}</Label>
            <Input id="email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
          <div className="mb-5">
            <Label htmlFor="password">{t('login.password')}</Label>
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

        <p className="mt-6 text-center text-sm text-ink/60">
          {t('login.newCaregiver')}{' '}
          <Link href="/register" className="font-medium text-brand-dark hover:underline">
            {t('register.title')}
          </Link>
        </p>
      </div>
    </div>
  );
}
