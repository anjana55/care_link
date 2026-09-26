'use client';

import Link from 'next/link';
import { useTranslation } from '@/lib/i18n';

interface RegistrationGateProps {
  open: boolean;
  onClose: () => void;
  /** Which action triggered the gate - only used for future analytics/copy
   * tailoring, not required to render. */
  reason?: 'contact' | 'save' | 'hire';
}

/**
 * The gate itself just routes to the real /register and /login pages
 * (phase 4 has landed - see AuthProvider/register/login) - this component
 * stays as the single place contact/save/hire actions decide *whether* to
 * interrupt with a sign-up prompt, without each of them re-implementing it.
 */
export function RegistrationGate({ open, onClose }: RegistrationGateProps) {
  const { t } = useTranslation();
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/40 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="registration-gate-title"
      onClick={onClose}
    >
      <div
        className="w-full max-w-md rounded-lg bg-white p-6 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="registration-gate-title" className="text-lg font-semibold text-ink">
          {t('registrationGate.title')}
        </h2>
        <p className="mt-2 text-sm text-ink/70">{t('registrationGate.body')}</p>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row">
          <Link
            href="/register"
            onClick={onClose}
            className="flex-1 rounded-DEFAULT bg-brand px-4 py-2 text-center text-sm font-medium text-white hover:bg-brand-dark"
          >
            {t('registrationGate.signUp')}
          </Link>
          <Link
            href="/login"
            onClick={onClose}
            className="flex-1 rounded-DEFAULT border border-border px-4 py-2 text-center text-sm font-medium text-ink hover:bg-paper"
          >
            {t('registrationGate.signIn')}
          </Link>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="mt-3 w-full text-center text-sm text-ink/50 hover:text-ink/80"
        >
          {t('registrationGate.cancel')}
        </button>
      </div>
    </div>
  );
}
