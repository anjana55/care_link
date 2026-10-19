'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { MessageCircle, Mail, X } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { rememberReturnTo } from '@/lib/return-to';
import { loadSearch, rememberPendingContact, type SearchContext } from '@/lib/care-intent';
import { useWhatsappConfig } from '@/lib/hooks/use-whatsapp-config';
import { CareNeedSummary, useSearchSummaryLines } from '@/components/care/care-need-summary';

interface RegistrationGateProps {
  open: boolean;
  onClose: () => void;
  /** Which action triggered the gate. Saving no longer needs an account (see SaveButton). */
  reason?: 'contact' | 'hire';
  /** The caregiver being contacted: remembered so the request dialog opens for them on return. */
  caregiverPublicId?: string;
  /** Where to bring the visitor back to once they are signed in (usually this page). */
  returnTo?: string;
}

/**
 * The one step between "Contact this caregiver" and the request itself for a
 * visitor who is not signed in. It stays on the caregiver's page and says what
 * happens next, shows what we already know from their search (so they can see
 * the sign-up will not ask it again), and puts the quickest way in first:
 * WhatsApp, which verifies their number in one code and needs no password.
 * Whichever way they go, they come back here with the request dialog open.
 */
export function RegistrationGate({ open, onClose, caregiverPublicId, returnTo }: RegistrationGateProps) {
  const { t } = useTranslation();
  const { data: whatsapp } = useWhatsappConfig();
  const [search, setSearch] = useState<SearchContext | null>(null);
  const lines = useSearchSummaryLines(search);

  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open) return;
    setSearch(loadSearch());
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeRef.current();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);

  if (!open) return null;

  const leave = () => {
    if (returnTo) rememberReturnTo(returnTo);
    if (caregiverPublicId) rememberPendingContact(caregiverPublicId);
  };

  const whatsappRegister = Boolean(whatsapp?.customer.register);
  const whatsappLogin = Boolean(whatsapp?.customer.login);
  const primary = 'flex w-full items-center justify-center gap-2 rounded-DEFAULT bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark';
  const secondary = 'flex w-full items-center justify-center gap-2 rounded-DEFAULT border border-border px-4 py-2.5 text-sm font-medium text-ink hover:bg-paper';

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-ink/40 p-0 sm:items-center sm:p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="registration-gate-title"
      onClick={onClose}
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-t-lg bg-white p-6 shadow-xl sm:rounded-lg" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-3">
          <h2 id="registration-gate-title" className="text-lg font-semibold text-ink">
            {t('registrationGate.title')}
          </h2>
          <button type="button" onClick={onClose} aria-label={t('registrationGate.cancel')} className="rounded p-1 text-ink/50 hover:bg-paper hover:text-ink">
            <X className="h-5 w-5" aria-hidden />
          </button>
        </div>
        <p className="mt-2 text-sm text-ink/70">{t('registrationGate.body')}</p>

        {lines.length > 0 && (
          <div className="mt-4">
            <CareNeedSummary title={t('careIntent.fromSearch')} lines={lines} />
            <p className="mt-2 text-xs text-ink/50">{t('registrationGate.reuseNote')}</p>
          </div>
        )}

        <div className="mt-5 space-y-2">
          {whatsappRegister && (
            <Link href="/register/whatsapp" onClick={leave} className={primary}>
              <MessageCircle className="h-4 w-4" aria-hidden />
              {t('registrationGate.continueWhatsapp')}
            </Link>
          )}
          <Link href="/register" onClick={leave} className={whatsappRegister ? secondary : primary}>
            <Mail className="h-4 w-4" aria-hidden />
            {t('registrationGate.continueEmail')}
          </Link>
        </div>

        <p className="mt-5 border-t border-border pt-4 text-center text-sm text-ink/60">
          {t('registrationGate.haveAccount')}{' '}
          <Link href="/login" onClick={leave} className="font-medium text-brand-dark hover:underline">
            {t('registrationGate.signIn')}
          </Link>
          {whatsappLogin && (
            <>
              {' · '}
              <Link href="/login/whatsapp" onClick={leave} className="font-medium text-brand-dark hover:underline">
                {t('registrationGate.signInWhatsapp')}
              </Link>
            </>
          )}
        </p>
      </div>
    </div>
  );
}
