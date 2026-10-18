'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CLIENT_CANCELLABLE_STATUSES, type CareRequestStatus, type ClientCareRequest } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { ApiError } from '@/lib/api/client';
import { useCancelRequest, useMyRequests } from '@/lib/hooks/use-client-care';
import { LoadingState, ErrorState } from '@/components/common/states';
import { CaregiverSummary } from '@/components/care/caregiver-summary';
import { Button } from '@/components/ui/button';

const TONE: Record<CareRequestStatus, string> = {
  NEW: 'bg-amber-100 text-amber-800',
  IN_PROGRESS: 'bg-sky-100 text-sky-800',
  INTRODUCED: 'bg-brand-light text-brand-dark',
  CLOSED: 'bg-paper text-ink/60',
  CANCELLED: 'bg-paper text-ink/60',
};

export default function MyRequestsPage() {
  const { t } = useTranslation();
  const { data, isLoading, isError, refetch } = useMyRequests();

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">{t('account.requests.title')}</h1>
      <p className="mt-1 text-sm text-ink/60">{t('account.requests.subtitle')}</p>

      <div className="mt-6">
        {isLoading && <LoadingState label={t('common.loading')} />}
        {isError && <ErrorState onRetry={() => refetch()} />}
        {data && data.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-white px-6 py-12 text-center">
            <p className="text-sm text-ink/60">{t('account.requests.empty')}</p>
            <Link href="/find" className="mt-4 inline-block rounded-DEFAULT bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
              {t('account.requests.emptyCta')}
            </Link>
          </div>
        )}
        {data && data.length > 0 && (
          <ul className="space-y-3">
            {data.map((r) => (
              <RequestRow key={r.id} request={r} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function RequestRow({ request }: { request: ClientCareRequest }) {
  const { t, locale } = useTranslation();
  const cancel = useCancelRequest();
  const [confirming, setConfirming] = useState(false);
  const canCancel = CLIENT_CANCELLABLE_STATUSES.includes(request.status);
  const date = new Date(request.createdAt).toLocaleDateString(locale === 'en' ? 'en-GB' : `${locale}-LK`, {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
  });
  const error = cancel.error instanceof ApiError && cancel.error.message ? cancel.error.message : cancel.error ? t('care.actionError') : null;

  return (
    <li className="rounded-lg border border-border bg-white p-4 sm:p-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <CaregiverSummary publicId={request.caregiverPublicId} caregiver={request.caregiver} />
        <span className={`self-start whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[request.status]}`}>
          {t(`account.requests.status.${request.status}`)}
        </span>
      </div>

      <p className="mt-3 text-sm text-ink/70">{t(`account.requests.statusHelp.${request.status}`)}</p>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-border pt-3">
        <p className="text-xs text-ink/50">
          <span className="font-medium tabular-nums text-ink/70">{t('account.requests.reference', { reference: request.reference })}</span>
          {' · '}
          {t('account.requests.sentOn', { date })}
        </p>
        {canCancel && !confirming && (
          <button type="button" onClick={() => setConfirming(true)} className="text-sm text-ink/60 underline-offset-2 hover:text-danger hover:underline">
            {t('account.requests.cancel')}
          </button>
        )}
      </div>

      {confirming && (
        <div className="mt-3 rounded-DEFAULT bg-paper p-3" role="group" aria-label={t('account.requests.cancel')}>
          <p className="text-sm text-ink/80">{t('account.requests.cancelConfirm')}</p>
          <div className="mt-3 flex gap-2">
            <Button
              variant="danger"
              size="sm"
              disabled={cancel.isPending}
              onClick={() => cancel.mutate(request.id, { onSuccess: () => setConfirming(false) })}
            >
              {t('account.requests.cancelYes')}
            </Button>
            <Button variant="secondary" size="sm" onClick={() => setConfirming(false)}>
              {t('account.requests.cancelNo')}
            </Button>
          </div>
          {error && (
            <p role="alert" className="mt-2 text-sm text-danger">
              {error}
            </p>
          )}
        </div>
      )}
    </li>
  );
}
