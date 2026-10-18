'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CheckCircle2, Heart } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useAuth } from '@/lib/api/auth-context';
import { useCaregiverRelations, useIsClient, useToggleSaved } from '@/lib/hooks/use-client-care';
import { RegistrationGate } from '@/components/common/registration-gate';
import { cn } from '@/lib/utils';
import { ContactDialog } from './contact-dialog';

/**
 * The Contact and Save actions for one caregiver, in whatever state the
 * visitor is in:
 *
 * - signed out: both buttons open the sign-up gate, which brings them back here;
 * - a caregiver's own session: a short note instead (contacting is for clients);
 * - a client: Contact opens the request dialog - or, once a request is open,
 *   shows its reference and a link to it - and Save toggles the shortlist.
 */
export function CaregiverActions({ publicId, caregiverLabel }: { publicId: string; caregiverLabel: string }) {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const client = useIsClient();
  const pathname = usePathname();
  const [gateOpen, setGateOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const relations = useCaregiverRelations(client ? [publicId] : []);
  const relation = relations.byId.get(publicId);

  if (loading) return <div className="mt-8 h-11" aria-hidden />;

  if (user && !client) {
    return <p className="mt-8 rounded-DEFAULT bg-paper p-3 text-sm text-ink/70">{t('care.caregiverAccountNote')}</p>;
  }

  if (!client) {
    return (
      <>
        <div className="mt-8 flex flex-col gap-2 sm:flex-row">
          <button
            type="button"
            onClick={() => setGateOpen(true)}
            className="flex-1 rounded-DEFAULT bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark"
          >
            {t('profile.contactCta')}
          </button>
          <button
            type="button"
            onClick={() => setGateOpen(true)}
            className="flex-1 rounded-DEFAULT border border-border px-4 py-2.5 text-sm font-medium text-ink/70 hover:bg-paper"
          >
            {t('profile.saveCta')}
          </button>
        </div>
        <RegistrationGate open={gateOpen} onClose={() => setGateOpen(false)} reason="contact" returnTo={pathname ?? undefined} />
      </>
    );
  }

  const open = relation?.openRequest;
  return (
    <>
      <div className="mt-8 flex flex-col gap-2 sm:flex-row">
        {open ? (
          <Link
            href="/account/requests"
            className="flex flex-1 items-center justify-center gap-2 rounded-DEFAULT border border-brand bg-brand-light px-4 py-2.5 text-sm font-semibold text-brand-dark hover:bg-brand-light/70"
          >
            <CheckCircle2 className="h-4 w-4" aria-hidden />
            {t('care.requestSent', { reference: open.reference })}
          </Link>
        ) : (
          <button
            type="button"
            onClick={() => setContactOpen(true)}
            disabled={relations.isLoading}
            className="flex-1 rounded-DEFAULT bg-brand px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
          >
            {t('care.contactCta')}
          </button>
        )}
        <SaveButton publicId={publicId} saved={Boolean(relation?.saved)} caregiverLabel={caregiverLabel} variant="full" />
      </div>
      <ContactDialog open={contactOpen} caregiverPublicId={publicId} onClose={() => setContactOpen(false)} />
    </>
  );
}

/**
 * Save / Saved toggle. `compact` is the heart on a result card; `full` the
 * labelled button on a profile. Only rendered for a signed-in client.
 */
export function SaveButton({
  publicId,
  saved,
  caregiverLabel,
  variant,
}: {
  publicId: string;
  saved: boolean;
  caregiverLabel: string;
  variant: 'compact' | 'full';
}) {
  const { t } = useTranslation();
  const toggle = useToggleSaved();
  // Optimistic: flip at once, settle when the list refetches.
  const [pending, setPending] = useState<boolean | null>(null);
  const [failed, setFailed] = useState(false);
  const shown = pending ?? saved;
  const label = failed
    ? t('care.actionError')
    : shown
      ? t('care.unsaveAria', { id: caregiverLabel })
      : t('care.saveAria', { id: caregiverLabel });

  const onClick = () => {
    const next = !shown;
    setPending(next);
    setFailed(false);
    toggle.mutate(
      { publicId, save: next },
      {
        onSettled: () => setPending(null),
        onError: () => setFailed(true),
      },
    );
  };

  if (variant === 'compact') {
    return (
      <button
        type="button"
        onClick={onClick}
        aria-pressed={shown}
        aria-label={label}
        title={label}
        className={cn(
          'flex h-9 w-9 shrink-0 items-center justify-center rounded-full border transition-colors',
          shown ? 'border-brand bg-brand-light text-brand-dark' : 'border-border text-ink/50 hover:text-brand',
          failed && 'border-danger text-danger',
        )}
      >
        <Heart className={cn('h-4 w-4', shown && 'fill-current')} aria-hidden />
      </button>
    );
  }

  return (
    <div className="flex flex-1 flex-col">
      <button
        type="button"
        onClick={onClick}
        aria-pressed={shown}
        aria-label={label}
        className={cn(
          'flex items-center justify-center gap-2 rounded-DEFAULT border px-4 py-2.5 text-sm font-medium transition-colors',
          shown ? 'border-brand bg-brand-light text-brand-dark' : 'border-border text-ink/70 hover:bg-paper',
        )}
      >
        <Heart className={cn('h-4 w-4', shown && 'fill-current')} aria-hidden />
        {shown ? t('care.saved') : t('care.save')}
      </button>
      {failed && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {t('care.actionError')}
        </p>
      )}
    </div>
  );
}
