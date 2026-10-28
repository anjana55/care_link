'use client';

import { useState } from 'react';
import { Trash2 } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { useOverseasDelete } from '@/lib/hooks/use-overseas-admin';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

/**
 * Admins only (renders nothing for anyone else): deletes one Overseas record
 * after a confirmation. When something still depends on the record the API
 * refuses and says what to do instead - that message shows in the dialog.
 */
export function DeleteRecordButton({
  path,
  title,
  body,
  onDeleted,
  compact = false,
  label,
}: {
  /** e.g. `/international/offers/<id>` */
  path: string;
  title: string;
  body: string;
  onDeleted?: () => void;
  /** Icon only, for rows in a list. */
  compact?: boolean;
  label?: string;
}) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const remove = useOverseasDelete();
  const [open, setOpen] = useState(false);
  if (user?.role !== 'ADMIN') return null;

  const text = label ?? t('common.delete');
  return (
    <>
      {compact ? (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="p-1.5 text-ink/50 hover:text-danger"
          aria-label={text}
          title={text}
          onClick={() => {
            remove.reset();
            setOpen(true);
          }}
        >
          <Trash2 size={15} aria-hidden />
        </Button>
      ) : (
        <Button
          type="button"
          size="sm"
          variant="danger"
          onClick={() => {
            remove.reset();
            setOpen(true);
          }}
        >
          <Trash2 size={14} aria-hidden className="mr-1.5" />
          {text}
        </Button>
      )}
      {open && (
        <ConfirmDialog
          title={title}
          message={body}
          tone="danger"
          confirmLabel={text}
          pending={remove.isPending}
          error={remove.error instanceof Error ? remove.error.message : remove.error ? t('common.actionFailed') : null}
          onCancel={() => setOpen(false)}
          onConfirm={() =>
            remove.mutate(path, {
              onSuccess: () => {
                setOpen(false);
                onDeleted?.();
              },
            })
          }
        />
      )}
    </>
  );
}
