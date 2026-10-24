'use client';

import { useState } from 'react';
import { UserSearch } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useAuth } from '@/lib/api/auth-context';
import { useIsClient } from '@/lib/hooks/use-client-care';
import { RegistrationGate } from '@/components/common/registration-gate';
import { ContactDialog } from './contact-dialog';

/** Where a visitor who signs up from this card lands: their requests, with the request form open. */
export const FIND_FOR_ME_RETURN = '/account/requests?new=1';

/**
 * "Ask us to find a caregiver" - a request with no caregiver chosen, for when
 * the results don't show the right person (or there are none). Staff match
 * someone and call the client, just as for a normal request.
 *
 * Prominent when the search found few or no caregivers, a quiet line otherwise.
 * A signed-out visitor goes through the same short sign-up as Contact and comes
 * back to their requests with the form open and prefilled from this search.
 */
export function FindForMeCard({ prominent }: { prominent: boolean }) {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const client = useIsClient();
  const [dialogOpen, setDialogOpen] = useState(false);
  const [gateOpen, setGateOpen] = useState(false);

  // A caregiver's own session has nothing to ask for here.
  if (loading || (user && !client)) return null;

  const start = () => (client ? setDialogOpen(true) : setGateOpen(true));

  return (
    <>
      {prominent ? (
        <div className="mt-6 flex flex-col gap-4 rounded-lg border border-brand/30 bg-brand-light/40 p-5 sm:flex-row sm:items-center">
          <UserSearch className="h-8 w-8 shrink-0 text-brand" aria-hidden />
          <div className="flex-1">
            <h2 className="text-base font-semibold text-ink">{t('care.findForMe.title')}</h2>
            <p className="mt-1 text-sm text-ink/70">{t('care.findForMe.body')}</p>
          </div>
          <button
            type="button"
            onClick={start}
            className="shrink-0 rounded-DEFAULT bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            {t('care.findForMe.cta')}
          </button>
        </div>
      ) : (
        <p className="mt-6 text-center text-sm text-ink/70">
          {t('care.findForMe.notFound')}{' '}
          <button type="button" onClick={start} className="font-semibold text-brand underline-offset-2 hover:underline">
            {t('care.findForMe.cta')}
          </button>
        </p>
      )}
      <ContactDialog open={dialogOpen} onClose={() => setDialogOpen(false)} />
      <RegistrationGate open={gateOpen} onClose={() => setGateOpen(false)} reason="find" returnTo={FIND_FOR_ME_RETURN} />
    </>
  );
}
