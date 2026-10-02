'use client';

import { useEffect } from 'react';
import { useTranslation } from '@/lib/i18n/provider';

/**
 * Caregiver WhatsApp sign-in moved to the public site at
 * /caregiver/login/whatsapp.
 *
 * The whole /staff area is office-staff-only now, and this flow was the
 * caregiver half of it - it was already gated on `config.caregiver.login`.
 * Tombstone so an old link still lands somewhere useful.
 */
export default function WhatsappLoginRedirect() {
  const { t } = useTranslation();

  useEffect(() => {
    window.location.replace('/caregiver/login/whatsapp');
  }, []);

  return (
    <div role="status" className="flex min-h-screen items-center justify-center text-sm text-ink/50">
      {t('common.loading')}
    </div>
  );
}
