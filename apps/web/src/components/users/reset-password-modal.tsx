'use client';

import { useState } from 'react';
import { useTranslation } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { Input, Label, FieldError } from '@/components/ui/input';

interface Props {
  submitting?: boolean;
  error?: string | null;
  onSubmit: (newPassword: string) => void;
  onClose: () => void;
}

export function ResetPasswordModal({ submitting, error, onSubmit, onClose }: Props) {
  const { t } = useTranslation();
  const [newPassword, setNewPassword] = useState('');

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-white p-6">
        <h3 className="mb-2 text-base font-semibold text-ink">{t('users.resetPasswordTitle')}</h3>
        <p className="mb-4 text-sm text-ink/60">{t('users.resetPasswordBody')}</p>
        <Label>{t('users.form.newPassword')}</Label>
        <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
        <FieldError message={error ?? undefined} />
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" size="sm" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button size="sm" disabled={newPassword.length < 8 || submitting} onClick={() => onSubmit(newPassword)}>
            {t('common.save')}
          </Button>
        </div>
      </div>
    </div>
  );
}
