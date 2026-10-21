'use client';

import { useState } from 'react';
import { useTranslation } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { Label, FieldError } from '@/components/ui/input';
import { PasswordInput } from '@/components/ui/password-input';

interface Props {
  submitting?: boolean;
  error?: string | null;
  onSubmit: (newPassword: string) => void;
  onClose: () => void;
}

export function ResetPasswordModal({ submitting, error, onSubmit, onClose }: Props) {
  const { t } = useTranslation();
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  // Shown as soon as the confirmation is filled in, so the admin sees the problem before pressing Save.
  const mismatch = confirmPassword.length > 0 && confirmPassword !== newPassword;
  const canSubmit = newPassword.length >= 8 && confirmPassword === newPassword && !submitting;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-white p-6">
        <h3 className="mb-2 text-base font-semibold text-ink">{t('users.resetPasswordTitle')}</h3>
        <p className="mb-4 text-sm text-ink/60">{t('users.resetPasswordBody')}</p>
        <div className="space-y-3">
          <div>
            <Label>{t('users.form.newPassword')}</Label>
            <PasswordInput autoComplete="new-password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
          </div>
          <div>
            <Label>{t('users.form.confirmPassword')}</Label>
            <PasswordInput autoComplete="new-password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
            <FieldError message={mismatch ? t('users.passwordMismatch') : undefined} />
          </div>
          <FieldError message={error ?? undefined} />
        </div>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" disabled={!canSubmit} onClick={() => onSubmit(newPassword)}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
