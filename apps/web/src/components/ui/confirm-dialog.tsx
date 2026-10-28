'use client';

import type { ReactNode } from 'react';
import { useTranslation } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';

/**
 * The one confirmation dialog the staff lists and detail pages share - delete,
 * a lifecycle move, revoking sign-in. Caregivers and clients used to each have
 * their own (a modal on one list, an inline strip on one detail page, a
 * primary-coloured confirm on another), which is exactly the inconsistency
 * staff noticed. `tone="danger"` is for anything destructive or restrictive.
 */
export function ConfirmDialog({
  title,
  message,
  confirmLabel,
  tone = 'primary',
  pending = false,
  error,
  onConfirm,
  onCancel,
  children,
}: {
  title: string;
  message?: ReactNode;
  confirmLabel?: string;
  tone?: 'primary' | 'danger';
  pending?: boolean;
  /** Shown under the message - a rejected request must not just close. */
  error?: string | null;
  onConfirm: () => void;
  onCancel: () => void;
  children?: ReactNode;
}) {
  const { t } = useTranslation();
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="w-full max-w-sm rounded-lg border border-border bg-white p-6">
        <h3 className="mb-2 text-base font-semibold text-ink">{title}</h3>
        {message && <div className="mb-4 text-sm text-ink/60">{message}</div>}
        {children}
        {error && <p className="mb-4 rounded bg-danger-light px-3 py-2 text-xs text-danger">{error}</p>}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" size="sm" onClick={onCancel} disabled={pending}>
            {t('common.cancel')}
          </Button>
          <Button type="button" variant={tone} size="sm" disabled={pending} onClick={onConfirm}>
            {pending ? t('common.loading') : (confirmLabel ?? t('common.confirm'))}
          </Button>
        </div>
      </div>
    </div>
  );
}
