'use client';

import { useEffect } from 'react';
import { useTranslation } from '@/lib/i18n/provider';

/**
 * Caregiver registration moved to the public site at /caregiver/register.
 *
 * Caregivers are a separate audience from office staff, so their sign-up no
 * longer lives behind the /staff basePath. This route is a tombstone: anyone
 * with an old bookmark, a printed flyer, or a message containing
 * /staff/register is forwarded to the new page.
 *
 * replace() rather than push() so the back button does not walk into this
 * stub again. A hard navigation on purpose - the destination is served by
 * another container, which this app's router cannot resolve; a client-side
 * redirect() would render a 404 instead.
 */
export default function RegisterRedirect() {
  const { t } = useTranslation();

  useEffect(() => {
    window.location.replace('/caregiver/register');
  }, []);

  return (
    <div role="status" className="flex min-h-screen items-center justify-center text-sm text-ink/50">
      {t('common.loading')}
    </div>
  );
}
