'use client';

import Link from 'next/link';
import { useTranslation } from '@/lib/i18n';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { RegistrationStatusBadge } from '@/components/portal/status-badge';
import { useAvailability, useDocuments, useOwnCaregiver, useSubmitRegistration } from '@/lib/hooks/use-caregiver-portal';

/**
 * Where the caregiver stands and what to do next.
 *
 * The checklist is derived from what is actually saved, not from a flag, so it
 * cannot disagree with the pages it links to. The submit button only appears for
 * a DRAFT registration - the API allows that one self-service transition and
 * nothing else - and is held back until the checklist is complete so a
 * half-filled registration is not sent to staff.
 */
export default function CaregiverDashboardPage() {
  const { t } = useTranslation();
  const { data: caregiver, isLoading, isError } = useOwnCaregiver();
  const { data: documents } = useDocuments();
  const { data: availability, isSuccess: availabilityLoaded } = useAvailability();
  const submit = useSubmitRegistration();

  if (isLoading) return <p className="text-sm text-ink/60">{t('common.loading')}</p>;
  if (isError || !caregiver) return <p role="alert" className="text-sm text-danger">{t('portal.loadError')}</p>;

  const steps = [
    { key: 'profile', done: caregiver.skills.length > 0 && caregiver.languages.length > 0, href: '/caregiver/profile' },
    { key: 'documents', done: (documents?.length ?? caregiver.documents.length) > 0, href: '/caregiver/documents' },
    { key: 'shifts', done: availabilityLoaded && availability !== null, href: '/caregiver/shifts' },
  ] as const;
  const complete = steps.every((s) => s.done);
  const error = submit.error instanceof ApiError ? submit.error.message : submit.error ? t('portal.saveError') : null;

  return (
    <div className="space-y-5">
      <section className="rounded-lg border border-border bg-white p-5">
        <p className="text-xs text-ink/50">{t('portal.welcome')}</p>
        <h1 className="text-xl font-semibold text-ink">{caregiver.fullName}</h1>
        <div className="mt-3 flex flex-wrap items-center gap-3">
          <RegistrationStatusBadge status={caregiver.status} />
          <span className="text-xs text-ink/50">
            {t('portal.registrationNumber')} {caregiver.registrationNumber}
          </span>
        </div>
        <p className="mt-3 text-sm text-ink/70">{t(`portal.statusHelp.${caregiver.status}`)}</p>
      </section>

      <section className="rounded-lg border border-border bg-white p-5">
        <h2 className="mb-3 text-sm font-semibold text-ink">{t('portal.checklist.title')}</h2>
        <ul className="divide-y divide-border">
          {steps.map((step) => (
            <li key={step.key} className="flex items-center justify-between gap-3 py-3">
              <div className="flex items-start gap-3">
                <span
                  aria-hidden="true"
                  className={`mt-0.5 flex h-5 w-5 items-center justify-center rounded-full text-xs ${
                    step.done ? 'bg-brand text-white' : 'border border-border text-transparent'
                  }`}
                >
                  ✓
                </span>
                <div>
                  <p className="text-sm font-medium text-ink">{t(`portal.checklist.${step.key}.title`)}</p>
                  <p className="text-xs text-ink/60">{t(`portal.checklist.${step.key}.hint`)}</p>
                </div>
              </div>
              <Link href={step.href} className="whitespace-nowrap text-sm font-medium text-brand-dark hover:underline">
                {step.done ? t('portal.checklist.review') : t('portal.checklist.start')}
                <span className="sr-only"> {t(`portal.checklist.${step.key}.title`)}</span>
              </Link>
            </li>
          ))}
        </ul>

        {caregiver.status === 'DRAFT' && (
          <div className="mt-4 border-t border-border pt-4">
            <p className="mb-3 text-sm text-ink/70">{complete ? t('portal.submit.ready') : t('portal.submit.notReady')}</p>
            {error && <p role="alert" className="mb-3 text-sm text-danger">{error}</p>}
            <Button onClick={() => submit.mutate()} disabled={!complete || submit.isPending}>
              {submit.isPending ? t('common.loading') : t('portal.submit.button')}
            </Button>
          </div>
        )}
      </section>
    </div>
  );
}
