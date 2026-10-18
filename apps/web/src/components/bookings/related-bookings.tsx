'use client';

import Link from 'next/link';
import { useTranslation } from '@/lib/i18n/provider';
import { useBookings } from '@/lib/hooks/use-bookings';
import { fmtDate } from '@/lib/colombo-time';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { BookingStatusBadge } from './booking-badges';

/** The bookings involving one client, caregiver or request. */
export function RelatedBookings({ patientId, caregiverId, careRequestId }: { patientId?: string; caregiverId?: string; careRequestId?: string }) {
  const { t, locale } = useTranslation();
  const { data, isLoading } = useBookings({ patientId, caregiverId, careRequestId, pageSize: 10 });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('bookings.related.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {isLoading && <p className="text-sm text-ink/50">{t('common.loading')}</p>}
        {data && data.items.length === 0 && <p className="text-sm text-ink/50">{t('bookings.related.empty')}</p>}
        {data && data.items.length > 0 && (
          <ul className="divide-y divide-border">
            {data.items.map((b) => (
              <li key={b.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <Link href={`/bookings/${b.id}`} className="font-medium tabular-nums text-brand-dark hover:underline">
                    {b.reference}
                  </Link>
                  <span className="ml-2 text-sm text-ink/60">{patientId ? b.caregiverName : b.clientName}</span>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-ink/50">
                    {fmtDate(b.startDate, locale)} – {fmtDate(b.endDate, locale)}
                  </span>
                  <BookingStatusBadge status={b.status} label={t(`bookings.status.${b.status}`)} />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}
