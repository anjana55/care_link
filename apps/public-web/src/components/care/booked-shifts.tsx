'use client';

import { useTranslation } from '@/lib/i18n';
import { useMyShifts } from '@/lib/hooks/use-caregiver-portal';
import { ShiftList } from './shift-list';

/**
 * The caregiver's confirmed work, read-only: staff arrange bookings and any
 * change to them by phone. Shows where (by area) and which booking, never the
 * client's name or address - staff share those when they call.
 */
export function BookedShifts() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useMyShifts();

  return (
    <section className="rounded-lg border border-border bg-white p-5" aria-labelledby="booked-shifts">
      <h2 id="booked-shifts" className="text-base font-semibold text-ink">
        {t('portal.shifts.bookedTitle')}
      </h2>
      <p className="mt-1 text-sm text-ink/60">{t('portal.shifts.bookedSubtitle')}</p>
      <div className="mt-3">
        {isLoading && <p className="text-sm text-ink/50">{t('common.loading')}</p>}
        {isError && <p className="text-sm text-danger">{t('care.actionError')}</p>}
        {data && data.length === 0 && <p className="text-sm text-ink/50">{t('portal.shifts.noBooked')}</p>}
        {data && data.length > 0 && (
          <ShiftList
            shifts={data}
            coverLabel={t('portal.shifts.cover')}
            extra={(s) => (
              <>
                {s.bookingReference}
                {s.area && ` · ${s.area}`}
              </>
            )}
          />
        )}
      </div>
    </section>
  );
}
