'use client';

import { useState } from 'react';
import { Check, Copy, KeyRound, Mail, RefreshCw } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { usePasswordHelp } from '@/lib/hooks/use-password-help';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input, Label } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { cn } from '@/lib/utils';

const MIN_LENGTH = 8;

/** Easy to read out over the phone: no 0/O, 1/l/I. */
function generatePassword(): string {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  const bytes = new Uint32Array(12);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => chars[b % chars.length]).join('');
}

/**
 * Admins only: help a caregiver or client who can't sign in with a password.
 * The usual way is to email them a link to choose their own (the link also
 * confirms their email address). Setting one directly is for someone who
 * can't use email - the admin tells them the password, and it is shown once.
 * Either way they are signed out everywhere when the new password is set.
 */
export function PasswordHelpCard({ path, refresh, email, hasPassword }: { path: string; refresh: unknown[]; email: string | null; hasPassword: boolean }) {
  const { t, locale } = useTranslation();
  const help = usePasswordHelp(path, refresh);
  const [mode, setMode] = useState<'SEND_LINK' | 'SET_PASSWORD'>('SEND_LINK');
  const [password, setPassword] = useState('');
  const [confirming, setConfirming] = useState(false);
  const [done, setDone] = useState<string | null>(null);
  const [shownPassword, setShownPassword] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const errorText = help.error instanceof Error ? help.error.message : help.error ? t('common.actionFailed') : null;

  const run = () => {
    setDone(null);
    setShownPassword(null);
    const body = mode === 'SEND_LINK' ? ({ mode } as const) : ({ mode, newPassword: password } as const);
    help.mutate(body, {
      onSuccess: (res) => {
        setConfirming(false);
        if (res.mode === 'SEND_LINK') {
          setDone(t('passwordHelp.linkSent', { email: res.email, time: res.expiresAt ? new Date(res.expiresAt).toLocaleString(locale) : '' }));
        } else {
          setDone(t('passwordHelp.passwordSet', { email: res.email }));
          setShownPassword(password);
          setCopied(false);
          setPassword('');
        }
      },
    });
  };

  if (!email) {
    return (
      <Card>
        <CardContent className="py-5">
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <KeyRound size={16} aria-hidden className="text-brand" />
            {t('passwordHelp.title')}
          </h3>
          <p className="mt-2 text-sm text-ink/60">{t('passwordHelp.noEmail')}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-4 py-5">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-ink">
            <KeyRound size={16} aria-hidden className="text-brand" />
            {t('passwordHelp.title')}
          </h3>
          <p className="mt-1 text-sm text-ink/60">{hasPassword ? t('passwordHelp.introHas') : t('passwordHelp.introNone')}</p>
        </div>

        <div role="radiogroup" aria-label={t('passwordHelp.title')} className="grid gap-3 sm:grid-cols-2">
          {(['SEND_LINK', 'SET_PASSWORD'] as const).map((m) => (
            <label key={m} className={cn('flex cursor-pointer gap-3 rounded border p-3 text-sm', mode === m ? 'border-brand bg-brand-light/40' : 'border-border hover:bg-paper')}>
              <input type="radio" name={`${path}-mode`} className="mt-1" checked={mode === m} onChange={() => setMode(m)} />
              <span>
                <span className="flex items-center gap-1.5 font-medium text-ink">
                  {m === 'SEND_LINK' ? <Mail size={14} aria-hidden /> : <KeyRound size={14} aria-hidden />}
                  {t(`passwordHelp.${m === 'SEND_LINK' ? 'sendLink' : 'setPassword'}`)}
                </span>
                <span className="mt-0.5 block text-xs text-ink/60">{m === 'SEND_LINK' ? t('passwordHelp.sendLinkHint', { email }) : t('passwordHelp.setPasswordHint')}</span>
              </span>
            </label>
          ))}
        </div>

        {mode === 'SET_PASSWORD' && (
          <div>
            <Label htmlFor={`${path}-pw`}>{t('passwordHelp.newPassword')}</Label>
            <div className="flex gap-2">
              <Input id={`${path}-pw`} value={password} onChange={(e) => setPassword(e.target.value)} maxLength={128} autoComplete="off" spellCheck={false} className="font-mono" />
              <Button type="button" variant="secondary" onClick={() => setPassword(generatePassword())}>
                <RefreshCw size={14} aria-hidden className="mr-1.5" />
                {t('passwordHelp.generate')}
              </Button>
            </div>
            <p className={cn('mt-1 text-xs', password && password.length < MIN_LENGTH ? 'text-danger' : 'text-ink/50')}>{t('passwordHelp.rule', { n: MIN_LENGTH })}</p>
          </div>
        )}

        <div className="flex flex-wrap items-center gap-3">
          <Button
            onClick={() => {
              help.reset();
              setConfirming(true);
            }}
            disabled={help.isPending || (mode === 'SET_PASSWORD' && password.length < MIN_LENGTH)}
          >
            {mode === 'SEND_LINK' ? t('passwordHelp.sendLinkButton') : t('passwordHelp.setPasswordButton')}
          </Button>
          <span className="text-xs text-ink/50">{t('passwordHelp.auditNote')}</span>
        </div>

        {done && (
          <div role="status" className="space-y-2 rounded border border-brand/40 bg-brand-light/40 p-3 text-sm text-ink">
            <p className="flex items-start gap-2">
              <Check size={16} aria-hidden className="mt-0.5 shrink-0 text-brand-dark" />
              {done}
            </p>
            {shownPassword && (
              <div className="flex flex-wrap items-center gap-2 pl-6">
                <code className="rounded bg-white px-2 py-1 font-mono text-base tracking-wide">{shownPassword}</code>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    void navigator.clipboard?.writeText(shownPassword).then(() => setCopied(true));
                  }}
                >
                  <Copy size={14} aria-hidden className="mr-1.5" />
                  {copied ? t('passwordHelp.copied') : t('passwordHelp.copy')}
                </Button>
                <span className="w-full text-xs text-ink/60">{t('passwordHelp.shownOnce')}</span>
              </div>
            )}
          </div>
        )}

        {confirming && (
          <ConfirmDialog
            title={mode === 'SEND_LINK' ? t('passwordHelp.confirmLinkTitle') : t('passwordHelp.confirmSetTitle')}
            message={mode === 'SEND_LINK' ? t('passwordHelp.confirmLinkBody', { email }) : t('passwordHelp.confirmSetBody', { email })}
            confirmLabel={mode === 'SEND_LINK' ? t('passwordHelp.sendLinkButton') : t('passwordHelp.setPasswordButton')}
            pending={help.isPending}
            error={errorText}
            onConfirm={run}
            onCancel={() => setConfirming(false)}
          />
        )}
      </CardContent>
    </Card>
  );
}
