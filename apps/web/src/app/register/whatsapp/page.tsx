'use client';

import { useEffect } from 'react';
import { useTranslation } from '@/lib/i18n/provider';

/**
 * Caregiver WhatsApp registration moved to the public site at
 * /caregiver/register/whatsapp. See the sibling page for why this is a
 * hard navigation rather than a client-side redirect.
 */
export default function RegisterWhatsappRedirect() {
  const { t } = useTranslation();

  useEffect(() => {
    window.location.replace('/caregiver/register/whatsapp');
  }, []);

  return (
    <div role="status" className="flex min-h-screen items-center justify-center text-sm text-ink/50">
      {t('common.loading')}
    </div>
  );
}
