'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useTranslation } from '@/lib/i18n/provider';
import { api, ApiError, type Tokens } from '@/lib/api/client';
import type { WhatsappOtpPurpose } from '@/lib/api/types';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';

interface Props {
  /** The number exactly as the user typed it - the API normalises it. */
  phone: string;
  purpose: WhatsappOtpPurpose;
  codeLength: number;
  /** Seconds before "send a new code" unlocks. */
  resendAfterSeconds: number;
  /** Development convenience only: the API returns the code when the Console provider is active. */
  devOtp?: string;
  onVerified: (tokens: Tokens) => void;
  onChangeNumber: () => void;
}

/**
 * The code-entry step shared by registration, login and recovery. It owns
 * only code entry, resend and the countdown; what happens with the tokens
 * once the code is accepted is up to the page that mounted it.
 */
export function WhatsappOtpForm({ phone, purpose, codeLength, resendAfterSeconds, devOtp, onVerified, onChangeNumber }: Props) {
  const { t } = useTranslation();
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [secondsLeft, setSecondsLeft] = useState(resendAfterSeconds);
  const [shownDevOtp, setShownDevOtp] = useState(devOtp);

  useEffect(() => {
    if (secondsLeft <= 0) return;
    const id = setTimeout(() => setSecondsLeft((s) => s - 1), 1000);
    return () => clearTimeout(id);
  }, [secondsLeft]);

  const verify = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    setInfo(null);
    setLoading(true);
    try {
      const tokens = await api.post<Tokens>('/auth/whatsapp/verify-otp', { phone, purpose, code: code.trim() });
      onVerified(tokens);
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : t('whatsapp.otp.error'));
    } finally {
      setLoading(false);
    }
  };

  const resend = async () => {
    setError(null);
    setInfo(null);
    try {
      const res = await api.post<{ message: string; resendAfterSeconds: number; devOtp?: string }>('/auth/whatsapp/request-otp', {
        phone,
        purpose,
      });
      setCode('');
      setShownDevOtp(res.devOtp);
      setSecondsLeft(res.resendAfterSeconds);
      setInfo(t('whatsapp.otp.resent'));
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : t('whatsapp.otp.error'));
    }
  };

  return (
    <form onSubmit={verify}>
      <p className="mb-4 text-sm text-ink/60">
        {t('whatsapp.otp.sentTo')} <span className="font-medium text-ink">{phone}</span>
      </p>
      <div className="mb-4">
        <Label htmlFor="otp" required>{t('whatsapp.otp.code')}</Label>
        <Input
          id="otp"
          inputMode="numeric"
          autoComplete="one-time-code"
          maxLength={codeLength}
          required
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
          className="text-center text-lg tracking-[0.4em]"
        />
      </div>

      {shownDevOtp && (
        <div className="mb-4 rounded border border-dashed border-accent bg-accent-light p-3">
          <p className="text-xs font-medium text-accent">{t('whatsapp.otp.devCode')}</p>
          <p className="mt-1 font-mono text-sm text-ink">{shownDevOtp}</p>
        </div>
      )}

      {error && <p className="mb-4 text-sm text-danger">{error}</p>}
      {info && <p className="mb-4 text-sm text-brand-dark">{info}</p>}

      <Button type="submit" className="w-full" disabled={loading || code.length < codeLength}>
        {loading ? t('common.loading') : t('whatsapp.otp.verify')}
      </Button>

      <div className="mt-4 flex items-center justify-between text-sm">
        <button type="button" onClick={onChangeNumber} className="text-ink/60 hover:text-ink hover:underline">
          {t('whatsapp.otp.changeNumber')}
        </button>
        <button
          type="button"
          onClick={resend}
          disabled={secondsLeft > 0}
          className="font-medium text-brand-dark hover:underline disabled:cursor-not-allowed disabled:text-ink/40 disabled:no-underline"
        >
          {secondsLeft > 0 ? `${t('whatsapp.otp.resendIn')} ${secondsLeft}s` : t('whatsapp.otp.resend')}
        </button>
      </div>
    </form>
  );
}
