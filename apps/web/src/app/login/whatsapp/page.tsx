'use client';

import { Suspense, useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/provider';
import { AuthHeader } from '@/components/layout/brand-mark';
import { useAuth, postLoginPath } from '@/lib/api/auth-context';
import { api, ApiError, type Tokens } from '@/lib/api/client';
import type { WhatsappOtpPurpose } from '@/lib/api/types';
import { useWhatsappConfig } from '@/lib/hooks/use-whatsapp';
import { Button } from '@/components/ui/button';
import { Input, Label, RequiredLegend } from '@/components/ui/input';
import { WhatsappOtpForm } from '@/components/auth/whatsapp-otp-form';

interface OtpRequestResult {
  resendAfterSeconds: number;
  devOtp?: string;
}

function WhatsappLoginInner() {
  const { t } = useTranslation();
  const router = useRouter();
  const { applyTokens } = useAuth();
  const params = useSearchParams();
  const { data: config, isLoading } = useWhatsappConfig();

  // ?mode=recover switches the same two-step flow to account recovery.
  const purpose: WhatsappOtpPurpose = params.get('mode') === 'recover' ? 'RECOVERY' : 'LOGIN';
  const recovering = purpose === 'RECOVERY';

  const [phone, setPhone] = useState('');
  const [step, setStep] = useState<'phone' | 'code'>('phone');
  const [sent, setSent] = useState<OtpRequestResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const available = recovering ? config?.caregiver.recovery : config?.caregiver.login;

  const requestCode = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // Deliberately the same screen whether or not the number has an account -
      // the API answers identically, so this can't be used to find out who is registered.
      const res = await api.post<OtpRequestResult>('/auth/whatsapp/request-otp', { phone, purpose });
      setSent(res);
      setStep('code');
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : t('whatsapp.login.error'));
    } finally {
      setLoading(false);
    }
  };

  const onVerified = (tokens: Tokens) => {
    const user = applyTokens(tokens);
    router.push(user ? postLoginPath(user) : '/login');
  };

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <AuthHeader />
      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 text-center">
            <h1 className="text-lg font-semibold text-ink">{recovering ? t('whatsapp.recover.title') : t('whatsapp.login.title')}</h1>
            <p className="text-sm text-ink/60">{recovering ? t('whatsapp.recover.subtitle') : t('whatsapp.login.subtitle')}</p>
          </div>

          <div className="rounded-lg border border-border bg-white p-6">
          {isLoading ? (
            <p className="text-sm text-ink/50">{t('common.loading')}</p>
          ) : !available ? (
            <p className="text-sm text-ink/70">{t('whatsapp.unavailable')}</p>
          ) : step === 'phone' ? (
            <form onSubmit={requestCode}>
              <RequiredLegend label={t('common.requiredField')} />
              <div className="mb-5">
                <Label htmlFor="phone" required>{t('whatsapp.login.phone')}</Label>
                <Input id="phone" type="tel" inputMode="tel" autoComplete="tel" required placeholder="0771234567" value={phone} onChange={(e) => setPhone(e.target.value)} />
                <p className="mt-1 text-xs text-ink/50">{t('whatsapp.login.phoneHint')}</p>
              </div>
              {error && <p className="mb-4 text-sm text-danger">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading || phone.trim().length < 7}>
                {loading ? t('common.loading') : t('whatsapp.login.sendCode')}
              </Button>
            </form>
          ) : (
            <WhatsappOtpForm
              phone={phone}
              purpose={purpose}
              codeLength={config?.otpLength ?? 6}
              resendAfterSeconds={sent?.resendAfterSeconds ?? 60}
              devOtp={sent?.devOtp}
              onVerified={onVerified}
              onChangeNumber={() => setStep('phone')}
            />
          )}
        </div>

        <div className="mt-6 space-y-2 text-center text-sm text-ink/60">
          {!recovering && (
            <p>
              <Link href="/login/whatsapp?mode=recover" className="font-medium text-brand-dark hover:underline">
                {t('whatsapp.login.lostAccess')}
              </Link>
            </p>
          )}
          {recovering && (
            <p>
              <Link href="/login/whatsapp" className="font-medium text-brand-dark hover:underline">
                {t('whatsapp.login.backToWhatsapp')}
              </Link>
            </p>
          )}
          <p>
            <Link href="/login" className="font-medium text-brand-dark hover:underline">
              {t('whatsapp.login.useEmail')}
            </Link>
          </p>
          <p>
            {t('login.newCaregiver')}{' '}
            <Link href="/register/whatsapp" className="font-medium text-brand-dark hover:underline">
              {t('whatsapp.register.link')}
            </Link>
          </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function WhatsappLoginPage() {
  // useSearchParams() needs a Suspense boundary for static prerendering.
  return (
    <Suspense fallback={null}>
      <WhatsappLoginInner />
    </Suspense>
  );
}
