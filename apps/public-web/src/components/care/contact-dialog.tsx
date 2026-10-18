'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { CheckCircle2, X } from 'lucide-react';
import { CARE_REQUEST_MESSAGE_MAX, type ClientCareRequest } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { ApiError } from '@/lib/api/client';
import { useSendRequest } from '@/lib/hooks/use-client-care';
import { Button } from '@/components/ui/button';
import { Label, Textarea } from '@/components/ui/input';

interface ContactDialogProps {
  open: boolean;
  caregiverPublicId: string;
  onClose: () => void;
}

/**
 * "Contact this caregiver" for a signed-in client. Contact is staff-mediated:
 * this only tells our team, who then call both sides, so the dialog says so
 * up front and asks for nothing but an optional note.
 */
export function ContactDialog({ open, caregiverPublicId, onClose }: ContactDialogProps) {
  const { t } = useTranslation();
  const send = useSendRequest();
  const [message, setMessage] = useState('');
  const [sent, setSent] = useState<ClientCareRequest | null>(null);
  const firstField = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!open) return;
    setSent(null);
    setMessage('');
    send.reset();
    // Focus the note so keyboard users land inside the dialog.
    const id = window.setTimeout(() => firstField.current?.focus(), 0);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      window.clearTimeout(id);
      window.removeEventListener('keydown', onKey);
    };
    // Reset only when the dialog opens.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!open) return null;

  const remaining = CARE_REQUEST_MESSAGE_MAX - message.length;
  const submit = () =>
    send.mutate(
      { caregiverPublicId, message: message.trim() || undefined },
      { onSuccess: (request) => setSent(request) },
    );
  const error = send.error instanceof ApiError && send.error.message ? send.error.message : send.error ? t('care.dialog.error') : null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="contact-dialog-title"
      onClick={onClose}
    >
      <div className="w-full max-w-md rounded-t-lg bg-white p-6 shadow-xl sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
        {sent ? (
          <div className="text-center" role="status" aria-live="polite">
            <CheckCircle2 className="mx-auto h-10 w-10 text-brand" aria-hidden />
            <h2 id="contact-dialog-title" className="mt-3 text-lg font-semibold text-ink">
              {t('care.dialog.successTitle')}
            </h2>
            <p className="mt-2 text-sm text-ink/70">{t('care.dialog.successBody', { reference: sent.reference })}</p>
            <div className="mt-6 flex flex-col gap-2 sm:flex-row">
              <Link
                href="/account/requests"
                className="flex-1 rounded-DEFAULT bg-brand px-4 py-2 text-center text-sm font-medium text-white hover:bg-brand-dark"
              >
                {t('care.viewRequests')}
              </Link>
              <Button variant="secondary" className="flex-1" onClick={onClose}>
                {t('care.dialog.close')}
              </Button>
            </div>
          </div>
        ) : (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (!send.isPending && remaining >= 0) submit();
            }}
          >
            <div className="flex items-start justify-between gap-3">
              <h2 id="contact-dialog-title" className="text-lg font-semibold text-ink">
                {t('care.dialog.title')}
              </h2>
              <button type="button" onClick={onClose} aria-label={t('care.dialog.close')} className="rounded p-1 text-ink/50 hover:bg-paper hover:text-ink">
                <X className="h-5 w-5" aria-hidden />
              </button>
            </div>
            <p className="mt-2 text-sm text-ink/70">{t('care.dialog.intro')}</p>

            <div className="mt-5">
              <Label htmlFor="contact-message">{t('care.dialog.messageLabel')}</Label>
              <Textarea
                id="contact-message"
                ref={firstField}
                rows={4}
                maxLength={CARE_REQUEST_MESSAGE_MAX}
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t('care.dialog.messagePlaceholder')}
                aria-describedby="contact-message-count"
              />
              <p id="contact-message-count" className="mt-1 text-right text-xs text-ink/40">
                {t('care.dialog.charsLeft', { count: remaining })}
              </p>
            </div>

            {error && (
              <p role="alert" className="mt-3 text-sm text-danger">
                {error}
              </p>
            )}

            <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button type="button" variant="secondary" onClick={onClose}>
                {t('care.dialog.cancel')}
              </Button>
              <Button type="submit" disabled={send.isPending}>
                {send.isPending ? t('care.dialog.sending') : t('care.dialog.send')}
              </Button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
