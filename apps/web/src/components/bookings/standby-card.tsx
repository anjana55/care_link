'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserCheck } from 'lucide-react';
import type { BookingStandby } from '@care-platform/shared';
import { api, ApiError } from '@/lib/api/client';
import { useTranslation } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { PhoneLink } from '@/components/clients/contact-links';

/**
 * The booking's standby caregiver: asked first, alone, whenever one of its
 * shifts needs cover (the caregiver said they cannot make it, or did not
 * come). Staff choose one from good fits for the next shift, or the booking
 * agent lines one up.
 */
export function StandbyCard({ bookingId, editable }: { bookingId: string; editable: boolean }) {
  const { t } = useTranslation();
  const qc = useQueryClient();
  const key = ['bookings', 'standby', bookingId];
  const { data } = useQuery({ queryKey: key, queryFn: () => api.get<BookingStandby>(`/bookings/${bookingId}/standby`) });
  const save = useMutation({
    mutationFn: (caregiverId: string | null) => api.put<BookingStandby>(`/bookings/${bookingId}/standby`, { caregiverId }),
    onSuccess: (next) => qc.setQueryData(key, next),
  });
  if (!data) return null;
  const error = save.error instanceof ApiError && save.error.message ? save.error.message : null;

  return (
    <Card data-testid="standby-card">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-sm">
          <UserCheck size={16} aria-hidden /> {t('bookings.standby.title')}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        <p className="text-xs text-ink/60">{t('bookings.standby.about')}</p>
        {data.standby ? (
          <div className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-3 py-2">
            <div>
              <p className="font-medium text-ink">
                {data.standby.fullName} <span className="font-normal text-ink/50">· {data.standby.registrationNumber}</span>
              </p>
              {data.setBy === 'AGENT' && <p className="text-xs text-ink/50">{t('bookings.standby.byAgent')}</p>}
              {data.standby.phone && <PhoneLink phone={data.standby.phone} whatsapp />}
            </div>
            {editable && (
              <Button size="sm" variant="ghost" disabled={save.isPending} onClick={() => save.mutate(null)}>
                {t('bookings.standby.remove')}
              </Button>
            )}
          </div>
        ) : (
          <p className="text-ink/60">{t('bookings.standby.none')}</p>
        )}
        {editable && data.suggestions.length > 0 && (
          <div>
            <p className="mb-1 text-xs font-medium uppercase tracking-wide text-ink/50">{t('bookings.standby.suggestions')}</p>
            <ul className="space-y-1">
              {data.suggestions.map((s) => (
                <li key={s.caregiverId} className="flex items-center justify-between gap-2">
                  <span>
                    {s.fullName} <span className="text-ink/50">· {s.registrationNumber}</span>
                    {s.reasons.length > 0 && <span className="block text-xs text-ink/50">{s.reasons.slice(0, 3).join(' · ')}</span>}
                  </span>
                  <Button size="sm" variant="secondary" disabled={save.isPending} onClick={() => save.mutate(s.caregiverId)}>
                    {t('bookings.standby.choose')}
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        )}
        {error && <p role="alert" className="text-sm text-danger">{error}</p>}
      </CardContent>
    </Card>
  );
}
