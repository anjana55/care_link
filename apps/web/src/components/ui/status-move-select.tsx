'use client';

import { useState, type ReactNode } from 'react';
import { useTranslation } from '@/lib/i18n/provider';
import { Select } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

export interface StatusMoveConfirmation {
  title: string;
  message: ReactNode;
  tone?: 'primary' | 'danger';
}

/**
 * "Move to…" - the lifecycle control in the header of the Caregiver and Client
 * detail pages. Offers only the next states the API accepts (the caller passes
 * them from the mirrored transition map) and always renders a blank prompt
 * option, so whichever status staff pick is a real change event.
 *
 * Moves that restrict someone (suspend, deactivate, reject...) go through a
 * confirmation explaining the consequence; the caller decides which those are.
 * A server rejection is shown in the dialog rather than silently reverting.
 */
export function StatusMoveSelect<S extends string>({
  statuses,
  labelOf,
  onMove,
  pending = false,
  error,
  confirmFor,
  onReset,
  className = 'w-52',
}: {
  statuses: S[];
  labelOf: (status: S) => string;
  onMove: (status: S, done: () => void) => void;
  pending?: boolean;
  error?: string | null;
  confirmFor?: (status: S) => StatusMoveConfirmation | null;
  /** Clears a previous attempt's error before the dialog opens again. */
  onReset?: () => void;
  className?: string;
}) {
  const { t } = useTranslation();
  const [target, setTarget] = useState<S | null>(null);

  if (statuses.length === 0) return null;

  const pick = (value: string) => {
    if (!value) return;
    const status = value as S;
    // Every move gets the dialog: one consistent experience, and an accidental
    // pick in a dropdown is too easy to make for something staff can't
    // necessarily undo (a rejected caregiver stays rejected).
    onReset?.();
    setTarget(status);
  };

  const confirmation = target
    ? (confirmFor?.(target) ?? {
        title: t('lifecycle.moveTitle', { status: labelOf(target) }),
        message: t('lifecycle.moveMessage', { status: labelOf(target) }),
      })
    : null;

  return (
    <>
      <Select
        className={className}
        value=""
        disabled={pending}
        aria-label={t('lifecycle.moveTo')}
        onChange={(e) => pick(e.target.value)}
      >
        <option value="">{t('lifecycle.moveTo')}</option>
        {statuses.map((s) => (
          <option key={s} value={s}>
            {labelOf(s)}
          </option>
        ))}
      </Select>

      {target && confirmation && (
        <ConfirmDialog
          title={confirmation.title}
          message={confirmation.message}
          tone={confirmation.tone ?? 'primary'}
          confirmLabel={t('lifecycle.moveConfirm', { status: labelOf(target) })}
          pending={pending}
          error={error}
          onCancel={() => setTarget(null)}
          onConfirm={() => onMove(target, () => setTarget(null))}
        />
      )}
    </>
  );
}
