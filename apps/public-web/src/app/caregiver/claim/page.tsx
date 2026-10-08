'use client';

import { useEffect, useState, type FormEvent } from 'react';
import Link from 'next/link';
import { useTranslation } from '@/lib/i18n';
import { api, ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { CaregiverRegisterShell } from '@/components/caregivers/caregiver-register-layout';
import { ProviderChoices } from '@/components/caregivers/provider-choices';

/**
 * "Finish setting up your account", for a caregiver who filled in the
 * registration form but never secured the account with Google, Microsoft or
 * Facebook - they skipped that step, the link ran out, or staff reset their
 * sign-in. Also for caregivers our office registered on their behalf.
 *
 * Three steps on one page: registration number, then the code sent to the
 * phone or email on the record (or one a staff member gave them), then the
 * same provider buttons the registration form ends with.
 *
 * The API answers the first step identically whether or not the number exists,
 * so this page never says "we sent it" - only "if this can be finished online,
 * a code is on its way".
 */

type Provider = 'GOOGLE' | 'MICROSOFT' | 'FACEBOOK';

interface StartResponse {
  message: string;
  resendAfterSeconds: number;
  /** Only outside production, when WhatsApp/email delivery is a console stub. */
  devCode?: string;
}

interface VerifyResponse {
  registrationNumber: string;
  pendingToken: string;
  pendingTokenExpiresInSeconds: number;
  providers: Record<Provider, boolean>;
}

type Step = 'number' | 'code' | 'providers';

export default function CaregiverClaimPage() {
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>('number');
  const [registrationNumber, setRegistrationNumber] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [started, setStarted] = useState<StartResponse | null>(null);
  const [cooldown, setCooldown] = useState(0);
  const [result, setResult] = useState<VerifyResponse | null>(null);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  const requestCode = async () => {
    setError(null);
    setBusy(true);
    try {
      const res = await api.post<StartResponse>('/auth/caregiver/claim/start', { registrationNumber: registrationNumber.trim() });
      setStarted(res);
      setCooldown(res.resendAfterSeconds);
      setStep('code');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('caregiverClaim.genericError'));
    } finally {
      setBusy(false);
    }
  };

  const onNumber = (e: FormEvent) => {
    e.preventDefault();
    if (!registrationNumber.trim()) {
      setError(t('caregiverClaim.numberRequired'));
      return;
    }
    void requestCode();
  };

  // A staff-issued code needs no code to be sent first.
  const skipToCode = () => {
    if (!registrationNumber.trim()) {
      setError(t('caregiverClaim.numberRequired'));
      return;
    }
    setError(null);
    setStarted(null);
    setStep('code');
  };

  const onCode = async (e: FormEvent) => {
    e.preventDefault();
    if (!code.trim()) {
      setError(t('caregiverClaim.codeRequired'));
      return;
    }
    setError(null);
    setBusy(true);
    try {
      const res = await api.post<VerifyResponse>('/auth/caregiver/claim/verify', {
        registrationNumber: registrationNumber.trim(),
        code: code.trim(),
      });
      setResult(res);
      setStep('providers');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('caregiverClaim.genericError'));
    } finally {
      setBusy(false);
    }
  };

  const startOver = () => {
    setStep('number');
    setCode('');
    setResult(null);
    setStarted(null);
    setError(null);
  };

  return (
    <CaregiverRegisterShell narrow>
      <div className="rounded-lg border border-border bg-white p-6">
        <h1 className="mb-1 text-lg font-semibold text-ink">{t('caregiverClaim.title')}</h1>

        {step === 'number' && (
          <form onSubmit={onNumber} noValidate>
            <p className="mb-5 text-sm text-ink/60">{t('caregiverClaim.intro')}</p>
            <Label htmlFor="registrationNumber" required>
              {t('caregiverClaim.numberLabel')}
            </Label>
            <Input
              id="registrationNumber"
              autoComplete="off"
              autoCapitalize="characters"
              placeholder="CG-2026-123456"
              value={registrationNumber}
              onChange={(e) => setRegistrationNumber(e.target.value)}
              aria-describedby="registrationNumberHint"
            />
            <p id="registrationNumberHint" className="mt-1 text-xs text-ink/40">
              {t('caregiverClaim.numberHint')}
            </p>
            {error && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {error}
              </p>
            )}
            <Button type="submit" className="mt-5 w-full" disabled={busy}>
              {busy ? t('common.loading') : t('caregiverClaim.sendCode')}
            </Button>
            <button type="button" onClick={skipToCode} className="mt-4 text-sm font-medium text-brand-dark hover:underline">
              {t('caregiverClaim.haveStaffCode')}
            </button>
          </form>
        )}

        {step === 'code' && (
          <form onSubmit={onCode} noValidate>
            <p className="mb-1 text-sm text-ink/60">
              {started ? t('caregiverClaim.codeSentBody') : t('caregiverClaim.staffCodeBody')}
            </p>
            <p className="mb-5 text-xs text-ink/40">
              {t('caregiverClaim.forNumber')} {registrationNumber.trim().toUpperCase()}
            </p>
            {started?.devCode && (
              <p className="mb-4 rounded border border-border bg-paper p-3 text-xs text-ink/60">
                {t('caregiverClaim.devCode')} <span className="font-semibold text-ink">{started.devCode}</span>
              </p>
            )}
            <Label htmlFor="claimCode" required>
              {t('caregiverClaim.codeLabel')}
            </Label>
            <Input
              id="claimCode"
              autoComplete="one-time-code"
              autoCapitalize="characters"
              value={code}
              onChange={(e) => setCode(e.target.value)}
            />
            {error && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {error}
              </p>
            )}
            <Button type="submit" className="mt-5 w-full" disabled={busy}>
              {busy ? t('common.loading') : t('caregiverClaim.verify')}
            </Button>
            <div className="mt-4 flex flex-wrap items-center justify-between gap-3 text-sm">
              <button
                type="button"
                onClick={() => void requestCode()}
                disabled={busy || cooldown > 0}
                className="font-medium text-brand-dark hover:underline disabled:cursor-not-allowed disabled:text-ink/40 disabled:no-underline"
              >
                {cooldown > 0 ? `${t('caregiverClaim.resendIn')} ${cooldown}s` : started ? t('caregiverClaim.resend') : t('caregiverClaim.sendCodeInstead')}
              </button>
              <button type="button" onClick={startOver} className="text-ink/60 underline hover:text-ink">
                {t('caregiverClaim.differentNumber')}
              </button>
            </div>
            <p className="mt-5 border-t border-border pt-4 text-xs text-ink/50">{t('caregiverClaim.noAccessHint')}</p>
          </form>
        )}

        {step === 'providers' && result && (
          <div>
            <p className="mb-1 text-sm text-ink/60">{t('caregiverClaim.verifiedBody')}</p>
            <p className="mb-5 text-xs text-ink/40">
              {t('caregiverSignup.regNumber')} {result.registrationNumber}
            </p>
            <ProviderChoices
              pendingToken={result.pendingToken}
              providers={result.providers}
              expiresInSeconds={result.pendingTokenExpiresInSeconds}
              expiredMessage={t('caregiverClaim.linkExpired')}
            />
            <button type="button" onClick={startOver} className="mt-5 text-sm text-ink/60 underline hover:text-ink">
              {t('caregiverClaim.startOver')}
            </button>
          </div>
        )}
      </div>

      <p className="mt-4 text-center text-sm text-ink/60">
        <Link href="/caregiver/login" className="font-medium text-brand-dark hover:underline">
          {t('caregiverSignup.backToLogin')}
        </Link>
      </p>
    </CaregiverRegisterShell>
  );
}
