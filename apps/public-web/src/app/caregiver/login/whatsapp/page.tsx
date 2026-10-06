'use client';

import { Suspense, useState, FormEvent } from 'react';
import Link from 'next/link';
import { useSearchParams } from 'next/navigation';
import type { WhatsappOtpPurpose } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { WhatsappOtpForm } from '@/components/auth/whatsapp-otp-form';
import { useAuth } from '@/lib/api/auth-context';
import { api, ApiError, type Tokens } from '@/lib/api/client';
import { useWhatsappConfig } from '@/lib/hooks/use-whatsapp-config';
import { Button } from '@/components/ui/button';
import { Input, Label, RequiredLegend } from '@/components/ui/input';

interface OtpRequestResult {
  resendAfterSeconds: number;
  devOtp?: string;
}

/**
 * WhatsApp sign-in and password recovery for caregivers. Structurally the same
 * two-step flow as the patient page at /login/whatsapp, but gated on the
 * `caregiver` half of the WhatsApp config rather than `customer`, and landing
 * on the caregiver profile instead of the public homepage.
 */
function WhatsappCaregiverLoginInner() {
  const { t } = useTranslation();
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

  async function requestCode(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      // Deliberately the same screen whether or not the number has an account -
      // the API answers identically, so this can't be used to find out who is registered.
      setSent(await api.post<OtpRequestResult>('/auth/whatsapp/request-otp', { phone, purpose, portal: 'caregiver' }));
      setStep('code');
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : t('whatsapp.login.error'));
    } finally {
      setLoading(false);
    }
  }

  function onVerified(tokens: Tokens) {
    // The decoded role is checked before leaving: a patient signing in at a
    // caregiver URL should land on their own home, not be pushed into the
    // caregiver wizard. Both destinations need a full navigation today.
    const user = applyTokens(tokens);
    window.location.assign(user?.role === 'CAREGIVER' ? '/caregiver/dashboard' : '/');
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader maxWidth="sm" />

      <div className="flex flex-1 items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm rounded-lg border border-border bg-white p-8">
          <h1 className="text-lg font-semibold text-ink">{t('caregiverLogin.title')}</h1>
          <p className="mt-1 text-sm text-ink/60">{t('caregiverLogin.subtitle')}</p>

          <div className="mt-6">
            {isLoading ? (
              <p className="text-sm text-ink/50">{t('common.loading')}</p>
            ) : !available ? (
              <p className="text-sm text-ink/70">{t('whatsapp.unavailable')}</p>
            ) : step === 'phone' ? (
              <form onSubmit={requestCode}>
                <RequiredLegend label={t('common.requiredField')} />
                <div className="mb-5">
                  <Label htmlFor="phone" required>{t('whatsapp.login.phone')}</Label>
                  <Input
                    id="phone"
                    type="tel"
                    inputMode="tel"
                    autoComplete="tel"
                    required
                    placeholder="0771234567"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                  <p className="mt-1 text-xs text-ink/50">{t('whatsapp.login.phoneHint')}</p>
                </div>
                {error && <p role="alert" className="mb-4 text-sm text-danger">{error}</p>}
                <Button type="submit" className="w-full" disabled={loading || phone.trim().length < 7}>
                  {loading ? t('common.loading') : t('whatsapp.login.sendCode')}
                </Button>
              </form>
            ) : (
              <WhatsappOtpForm
              portal="caregiver"
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
              <p>
                <Link href="/caregiver/login/whatsapp" className="font-medium text-brand-dark hover:underline">
                  {t('whatsapp.login.backToWhatsapp')}
                </Link>
              </p>
            ) : (
              <p>
                <Link href="/caregiver/login/whatsapp?mode=recover" className="font-medium text-brand-dark hover:underline">
                  {t('whatsapp.login.lostAccess')}
                </Link>
              </p>
            )}
            <p>
              <Link href="/caregiver/login" className="font-medium text-brand-dark hover:underline">
                {t('whatsapp.login.useEmail')}
              </Link>
            </p>
            <p>
              {t('caregiverLogin.noAccount')}{' '}
              <Link href="/caregiver/join" className="font-medium text-brand-dark hover:underline">
                {t('caregiverRegister.join.title')}
              </Link>
            </p>
          </div>
        </div>
      </div>

      <SiteFooter />
    </div>
  );
}

export default function WhatsappCaregiverLoginPage() {
  // useSearchParams() needs a Suspense boundary for static prerendering.
  return (
    <Suspense fallback={null}>
      <WhatsappCaregiverLoginInner />
    </Suspense>
  );
}