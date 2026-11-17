'use client';

import type { ClientBooking } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { fmtDay, fmtTime } from '@/lib/colombo-time';

/**
 * The code the client reads to the caregiver at the door, for each visit
 * that is about to start or under way with nobody checked in. Shown large,
 * at the top of Bookings, and gone once the caregiver is in. Nothing when
 * check-in is off or no visit is near.
 */
export function ArrivalCodes({ bookings }: { bookings: ClientBooking[] }) {
  const { t, locale } = useTranslation();
  const due = bookings
    .flatMap((b) => b.shifts)
    .filter((s) => s.visit?.arrivalCode)
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt))
    .slice(0, 3);
  if (!due.length) return null;
  return (
    <ul className="mb-6 space-y-3">
      {due.map((s) => (
        <li key={s.id} className="rounded-lg border border-brand bg-brand-light/40 p-4 sm:p-5">
          <section aria-labelledby={`code-${s.id}`}>
            <h2 id={`code-${s.id}`} className="text-base font-semibold text-ink">
              {t('checkIn.client.title')}
            </h2>
            <p className="text-sm text-ink/70">{t('checkIn.client.forVisit', { day: fmtDay(s.startsAt, locale), start: fmtTime(s.startsAt, locale), end: fmtTime(s.endsAt, locale) })}</p>
            <p className="my-2 text-4xl font-semibold tabular-nums tracking-[0.3em] text-brand-dark" aria-label={s.visit!.arrivalCode!.split('').join(' ')}>
              {s.visit!.arrivalCode}
            </p>
            <p className="text-sm text-ink/70">{t('checkIn.client.hint')}</p>
          </section>
        </li>
      ))}
    </ul>
  );
}
