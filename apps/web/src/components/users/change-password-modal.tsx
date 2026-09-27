'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useTranslation } from '@/lib/i18n/provider';
import { api, ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input, Label, FieldError } from '@/components/ui/input';

export function ChangePasswordModal({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const mutation = useMutation({
    mutationFn: () => api.post('/auth/change-password', { currentPassword, newPassword }),
    onSuccess: () => setSuccess(true),
    onError: (err: unknown) => setError(err instanceof ApiError ? err.message : 'Something went wrong'),
  });

  const submit = () => {
    setError(null);
    if (newPassword !== confirmPassword) {
      setError(t('changePassword.mismatch'));
      return;
    }
    mutation.mutate();
  };

  const canSubmit = currentPassword.length > 0 && newPassword.length >= 8 && confirmPassword.length >= 8;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
      <div className="w-full max-w-sm rounded-lg border border-border bg-white p-6">
        <h3 className="mb-4 text-base font-semibold text-ink">{t('changePassword.title')}</h3>
        {success ? (
          <>
            <p className="mb-5 text-sm text-ink/70">{t('changePassword.success')}</p>
            <div className="flex justify-end">
              <Button size="sm" onClick={onClose}>
                {t('common.confirm')}
              </Button>
            </div>
          </>
        ) : (
          <>
            <div className="space-y-3">
              <div>
                <Label>{t('changePassword.currentPassword')}</Label>
                <Input type="password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} />
              </div>
              <div>
                <Label>{t('changePassword.newPassword')}</Label>
                <Input type="password" value={newPassword} onChange={(e) => setNewPassword(e.target.value)} />
              </div>
              <div>
                <Label>{t('changePassword.confirmPassword')}</Label>
                <Input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} />
              </div>
              <FieldError message={error ?? undefined} />
            </div>
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={onClose}>
                {t('common.cancel')}
              </Button>
              <Button size="sm" disabled={!canSubmit || mutation.isPending} onClick={submit}>
                {t('common.save')}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
