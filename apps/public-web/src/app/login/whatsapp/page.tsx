'use client';

import { Suspense, useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import type { WhatsappOtpPurpose } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { WhatsappOtpForm } from '@/components/auth/whatsapp-otp-form';
import { useAuth } from '@/lib/api/auth-context';
import { api, ApiError, type Tokens } from '@/lib/api/client';
import { useWhatsappConfig } from '@/lib/hooks/use-whatsapp-config';
import { Input, Label } from '@/components/ui/input';

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

  const available = recovering ? config?.customer.recovery : config?.customer.login;

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // Deliberately the same screen whether or not the number has an account -
      // the API answers identically, so this can't be used to find out who is registered.
      setSent(await api.post<OtpRequestResult>('/auth/whatsapp/request-otp', { phone, purpose, portal: 'customer' }));
      setStep('code');
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : t('whatsapp.login.error'));
    } finally {
      setLoading(false);
    }
  }

  function onVerified(tokens: Tokens) {
    applyTokens(tokens);
    router.push('/');
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader maxWidth="sm" />

      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm rounded-lg border border-border bg-white p-8">
          <h1 className="text-lg font-semibold text-ink">{recovering ? t('whatsapp.recover.title') : t('whatsapp.login.title')}</h1>
          <p className="mt-1 text-sm text-ink/60">{recovering ? t('whatsapp.recover.subtitle') : t('whatsapp.login.subtitle')}</p>

          <div className="mt-6">
            {isLoading ? (
              <p className="text-sm text-ink/50">…</p>
            ) : !available ? (
              <p className="text-sm text-ink/70">{t('whatsapp.unavailable')}</p>
            ) : step === 'phone' ? (
              <form onSubmit={requestCode} className="space-y-4">
                <div>
                  <Label htmlFor="phone" >{t('whatsapp.login.phone')}</Label>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    placeholder="0771234567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    />
                  <p className="mt-1 text-xs text-ink/50">{t('whatsapp.login.phoneHint')}</p>
                </div>
                {error && <p role="alert" className="text-sm text-danger">{error}</p>}
                <button
                  type="submit"
                  disabled={loading || phone.trim().length < 7}
                  className="w-full rounded-DEFAULT bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-60"
                >
                  {loading ? '…' : t('whatsapp.login.sendCode')}
                </button>
              </form>
            ) : (
              <WhatsappOtpForm
              portal="customer"
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
            {recovering ? (
              <p><Link href="/login/whatsapp" className="font-medium text-brand-dark hover:underline">{t('whatsapp.login.backToWhatsapp')}</Link></p>
            ) : (
              <p><Link href="/login/whatsapp?mode=recover" className="font-medium text-brand-dark hover:underline">{t('whatsapp.login.lostAccess')}</Link></p>
            )}
            <p><Link href="/login" className="font-medium text-brand-dark hover:underline">{t('whatsapp.login.useEmail')}</Link></p>
            <p>
              {t('login.noAccount')}{' '}
              <Link href="/register/whatsapp" className="font-medium text-brand-dark hover:underline">{t('whatsapp.register.link')}</Link>
            </p>
          </div>
        </div>
      </div>

      <SiteFooter />
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
