'use client';

import Link from 'next/link';
import { useTranslation } from '@/lib/i18n';
import { useCaregiverRelations, useSavedCaregivers, useToggleSaved } from '@/lib/hooks/use-client-care';
import { LoadingState, ErrorState } from '@/components/common/states';
import { CaregiverSummary } from '@/components/care/caregiver-summary';
import { Button } from '@/components/ui/button';
import { CheckCircle2 } from 'lucide-react';

export default function SavedCaregiversPage() {
  const { t, locale } = useTranslation();
  const { data, isLoading, isError, refetch } = useSavedCaregivers();
  const toggle = useToggleSaved();
  const relations = useCaregiverRelations((data ?? []).filter((s) => s.caregiver).map((s) => s.caregiverPublicId));

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">{t('account.saved.title')}</h1>
      <p className="mt-1 text-sm text-ink/60">{t('account.saved.subtitle')}</p>

      <div className="mt-6">
        {isLoading && <LoadingState label={t('common.loading')} />}
        {isError && <ErrorState onRetry={() => refetch()} />}
        {data && data.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-white px-6 py-12 text-center">
            <p className="text-sm text-ink/60">{t('account.saved.empty')}</p>
            <Link href="/find" className="mt-4 inline-block rounded-DEFAULT bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
              {t('account.requests.emptyCta')}
            </Link>
          </div>
        )}
        {data && data.length > 0 && (
          <ul className="space-y-3">
            {data.map((s) => {
              const open = relations.byId.get(s.caregiverPublicId)?.openRequest;
              const date = new Date(s.savedAt).toLocaleDateString(locale === 'en' ? 'en-GB' : `${locale}-LK`, {
                day: 'numeric',
                month: 'short',
                year: 'numeric',
              });
              return (
                <li key={s.caregiverPublicId} className="rounded-lg border border-border bg-white p-4 sm:p-5">
                  <CaregiverSummary publicId={s.caregiverPublicId} caregiver={s.caregiver} />
                  <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
                    <p className="text-xs text-ink/50">{t('account.saved.savedOn', { date })}</p>
                    <div className="flex flex-wrap items-center gap-3">
                      {open ? (
                        <Link href="/account/requests" className="flex items-center gap-1.5 text-sm font-medium text-brand-dark hover:underline">
                          <CheckCircle2 className="h-4 w-4" aria-hidden />
                          {t('care.requestSent', { reference: open.reference })}
                        </Link>
                      ) : (
                        s.caregiver && (
                          <Link href={`/caregivers/${s.caregiverPublicId}`} className="text-sm font-medium text-brand hover:underline">
                            {t('care.contactCta')}
                          </Link>
                        )
                      )}
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={toggle.isPending}
                        onClick={() => toggle.mutate({ publicId: s.caregiverPublicId, save: false })}
                      >
                        {t('account.saved.remove')}
                      </Button>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
