'use client';

import Link from 'next/link';
import type { BookingStatus } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useMyBookings } from '@/lib/hooks/use-client-care';
import { fmtDate } from '@/lib/colombo-time';
import { LoadingState, ErrorState } from '@/components/common/states';
import { CaregiverSummary } from '@/components/care/caregiver-summary';
import { ShiftList } from '@/components/care/shift-list';

const TONE: Record<BookingStatus, string> = {
  DRAFT: 'bg-paper text-ink/60',
  CONFIRMED: 'bg-brand-light text-brand-dark',
  COMPLETED: 'bg-paper text-ink/60',
  CANCELLED: 'bg-paper text-ink/60',
};

/** The client's confirmed bookings: caregiver (public profile), dates, agreed rate and shifts. */
export default function MyBookingsPage() {
  const { t, locale } = useTranslation();
  const { data, isLoading, isError, refetch } = useMyBookings();

  return (
    <div>
      <h1 className="text-xl font-semibold text-ink">{t('account.bookings.title')}</h1>
      <p className="mt-1 text-sm text-ink/60">{t('account.bookings.subtitle')}</p>
      <div className="mt-6">
        {isLoading && <LoadingState label={t('common.loading')} />}
        {isError && <ErrorState onRetry={() => refetch()} subtitle={t('error.page')} />}
        {data && data.length === 0 && (
          <div className="rounded-lg border border-dashed border-border bg-white px-6 py-12 text-center">
            <p className="text-sm text-ink/60">{t('account.bookings.empty')}</p>
            <Link href="/account/requests" className="mt-4 inline-block text-sm font-medium text-brand hover:underline">
              {t('care.viewRequests')}
            </Link>
          </div>
        )}
        {data && data.length > 0 && (
          <ul className="space-y-4">
            {data.map((b) => (
              <li key={b.id} className="rounded-lg border border-border bg-white p-4 sm:p-5">
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <CaregiverSummary publicId={b.caregiverPublicId} caregiver={b.caregiver} unavailableText={t('account.requests.notOnline')} />
                  <span className={`self-start whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-medium ${TONE[b.status]}`}>
                    {t(`account.bookings.status.${b.status}`)}
                  </span>
                </div>
                <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                  <div>
                    <dt className="text-xs text-ink/50">{t('account.bookings.reference')}</dt>
                    <dd className="font-medium tabular-nums text-ink">{b.reference}</dd>
                  </div>
                  <div>
                    <dt className="text-xs text-ink/50">{t('account.bookings.dates')}</dt>
                    <dd className="text-ink">
                      {fmtDate(b.startDate, locale)} – {fmtDate(b.endDate, locale)}
                    </dd>
                  </div>
                  {b.rateType && b.rateAmount && (
                    <div>
                      <dt className="text-xs text-ink/50">{t('account.bookings.rate')}</dt>
                      <dd className="text-ink">
                        LKR {Number(b.rateAmount).toLocaleString('en-LK', { minimumFractionDigits: 2 })} {t(`account.bookings.rateUnit.${b.rateType}`)}
                      </dd>
                    </div>
                  )}
                </dl>
                <div className="mt-3 border-t border-border pt-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-ink/50">{t('account.bookings.shifts')}</p>
                  {b.shifts.length === 0 ? (
                    <p className="py-2 text-sm text-ink/50">{t('account.bookings.noShifts')}</p>
                  ) : (
                    <ShiftList shifts={b.shifts} coverLabel={t('account.bookings.cover')} />
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
