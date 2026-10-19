'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter, useSearchParams } from 'next/navigation';
import { ChevronLeft, Search, X } from 'lucide-react';
import { addDays, colomboToday } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { ApiError } from '@/lib/api/client';
import { useBooking, useBookings } from '@/lib/hooks/use-bookings';
import { useClient } from '@/lib/hooks/use-clients';
import { useCreateInvoice } from '@/lib/hooks/use-billing';
import { fmtDate } from '@/lib/colombo-time';
import { useDebounced } from '@/components/requests/caregiver-picker';
import { ClientPicker } from '@/components/requests/client-picker';
import { BookingStatusBadge } from '@/components/bookings/booking-badges';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { InvoiceBasis } from '@/lib/api/types';

const BASES: InvoiceBasis[] = ['COMPLETED', 'SCHEDULED', 'MANUAL'];

/** First and last day of the calendar month `offset` months from this one (Colombo). */
function month(offset: number) {
  const [y, m] = colomboToday().split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + offset, 1));
  const first = d.toISOString().slice(0, 10);
  const last = addDays(new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1)).toISOString().slice(0, 10), -1);
  return { first, last };
}

/**
 * Start an invoice: for one booking or for all of a client's bookings, over a
 * period, from the shifts done (usual), the shifts scheduled (billing in
 * advance), or empty. The draft it makes is then shaped on its own page.
 */
function NewInvoice() {
  const { t, locale } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const params = useSearchParams();
  const create = useCreateInvoice();

  const [scope, setScope] = useState<'booking' | 'client'>(params.get('patientId') && !params.get('bookingId') ? 'client' : 'booking');
  const [bookingId, setBookingId] = useState(params.get('bookingId') ?? '');
  const [patientId, setPatientId] = useState(params.get('patientId') ?? '');
  const [basis, setBasis] = useState<InvoiceBasis>('COMPLETED');
  const last = month(-1);
  const [periodStart, setPeriodStart] = useState(last.first);
  const [periodEnd, setPeriodEnd] = useState(last.last);
  const [language, setLanguage] = useState<'en' | 'si' | 'ta' | ''>('');
  const { data: booking } = useBooking(bookingId);
  const { data: client } = useClient(scope === 'client' && patientId ? patientId : undefined);

  useEffect(() => {
    if (!authLoading && user && user.role !== 'ADMIN' && user.role !== 'STAFF') router.replace('/dashboard');
  }, [authLoading, user, router]);

  const who = scope === 'booking' ? Boolean(bookingId) : Boolean(patientId);
  const periodOk = basis === 'MANUAL' || (periodStart && periodEnd && periodEnd >= periodStart);
  const ready = who && periodOk && !create.isPending;

  const submit = () =>
    create.mutate(
      {
        ...(scope === 'booking' ? { bookingId } : { patientId }),
        basis,
        ...(basis !== 'MANUAL' || periodStart ? { periodStart, periodEnd } : {}),
        ...(language ? { language } : {}),
      },
      { onSuccess: (inv) => router.push(`/invoices/${inv.id}`) },
    );

  const quick = [
    { key: 'lastMonth', ...month(-1) },
    { key: 'thisMonth', ...month(0) },
    ...(booking ? [{ key: 'wholeBooking', first: booking.startDate, last: booking.endDate }] : []),
  ];

  return (
    <div className="max-w-3xl">
      <Link href="/invoices" className="mb-4 inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink">
        <ChevronLeft size={16} />
        {t('billing.invoices.back')}
      </Link>
      <h1 className="text-xl font-semibold text-ink">{t('billing.newInvoice.title')}</h1>
      <p className="mb-6 mt-1 text-sm text-ink/60">{t('billing.newInvoice.subtitle')}</p>

      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('billing.newInvoice.whoTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex gap-1 rounded bg-paper p-1 text-sm" role="tablist">
              {(['booking', 'client'] as const).map((s) => (
                <button
                  key={s}
                  role="tab"
                  aria-selected={scope === s}
                  onClick={() => setScope(s)}
                  className={cn('flex-1 rounded px-3 py-1.5 font-medium', scope === s ? 'bg-white text-ink shadow-sm' : 'text-ink/60 hover:text-ink')}
                >
                  {t(`billing.newInvoice.scope.${s}`)}
                </button>
              ))}
            </div>
            {scope === 'booking' ? (
              bookingId && booking ? (
                <div className="flex items-start justify-between gap-3 rounded border border-border px-3 py-2">
                  <div className="text-sm">
                    <p className="flex items-center gap-2 font-medium tabular-nums text-ink">
                      {booking.reference}
                      <BookingStatusBadge status={booking.status} label={t(`bookings.status.${booking.status}`)} />
                    </p>
                    <p className="text-ink/60">
                      {booking.client?.fullName} · {booking.caregiver?.fullName}
                    </p>
                    <p className="text-xs text-ink/50">
                      {fmtDate(booking.startDate, locale)} – {fmtDate(booking.endDate, locale)} ·{' '}
                      {booking.rateType && booking.rateAmount ? `LKR ${booking.rateAmount} ${t(`bookings.rateUnit.${booking.rateType}`)}` : t('billing.newInvoice.noRate')}
                    </p>
                  </div>
                  <button type="button" className="rounded p-1 text-ink/50 hover:bg-paper hover:text-ink" onClick={() => setBookingId('')} aria-label={t('billing.newInvoice.change')}>
                    <X size={16} />
                  </button>
                </div>
              ) : (
                <BookingPicker onPick={setBookingId} />
              )
            ) : patientId && client ? (
              <div className="flex items-start justify-between gap-3 rounded border border-border px-3 py-2 text-sm">
                <div>
                  <p className="font-medium text-ink">{client.fullName}</p>
                  <p className="text-xs text-ink/50">{t('billing.newInvoice.allBookingsHint')}</p>
                </div>
                <button type="button" className="rounded p-1 text-ink/50 hover:bg-paper hover:text-ink" onClick={() => setPatientId('')} aria-label={t('billing.newInvoice.change')}>
                  <X size={16} />
                </button>
              </div>
            ) : (
              <ClientPicker onPick={(c) => setPatientId(c.id)} />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('billing.newInvoice.basisTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {BASES.map((b) => (
              <label key={b} className={cn('flex cursor-pointer gap-3 rounded border px-3 py-2', basis === b ? 'border-brand bg-brand-light/40' : 'border-border hover:bg-paper')}>
                <input type="radio" name="basis" className="mt-1 accent-brand" checked={basis === b} onChange={() => setBasis(b)} />
                <span>
                  <span className="block text-sm font-medium text-ink">{t(`billing.basis.${b}.title`)}</span>
                  <span className="block text-xs text-ink/60">{t(`billing.basis.${b}.hint`)}</span>
                </span>
              </label>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('billing.newInvoice.periodTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex flex-wrap gap-2">
              {quick.map((q) => (
                <Button
                  key={q.key}
                  size="sm"
                  variant={periodStart === q.first && periodEnd === q.last ? 'primary' : 'secondary'}
                  onClick={() => {
                    setPeriodStart(q.first);
                    setPeriodEnd(q.last);
                  }}
                >
                  {t(`billing.newInvoice.quick.${q.key}`)}
                </Button>
              ))}
            </div>
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="periodStart" required={basis !== 'MANUAL'}>{t('billing.newInvoice.from')}</Label>
                <Input id="periodStart" type="date" value={periodStart} onChange={(e) => setPeriodStart(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="periodEnd" required={basis !== 'MANUAL'}>{t('billing.newInvoice.to')}</Label>
                <Input id="periodEnd" type="date" min={periodStart} value={periodEnd} onChange={(e) => setPeriodEnd(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="language">{t('billing.newInvoice.language')}</Label>
                <Select id="language" value={language} onChange={(e) => setLanguage(e.target.value as 'en' | 'si' | 'ta' | '')}>
                  <option value="">{t('billing.newInvoice.languageDefault')}</option>
                  {(['en', 'si', 'ta'] as const).map((l) => (
                    <option key={l} value={l}>
                      {t(`requests.detail.language.${l}`)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <p className="text-xs text-ink/50">{t('billing.newInvoice.periodHint')}</p>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={!ready} onClick={submit}>
            {t('billing.newInvoice.submit')}
          </Button>
          <span className="text-xs text-ink/50">{t('billing.newInvoice.draftHint')}</span>
        </div>
        {create.isError && (
          <p role="alert" className="text-sm text-danger">
            {create.error instanceof ApiError && create.error.message ? create.error.message : t('requests.detail.saveFailed')}
          </p>
        )}
      </div>
    </div>
  );
}

function BookingPicker({ onPick }: { onPick: (id: string) => void }) {
  const { t, locale } = useTranslation();
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const { data, isFetching } = useBookings({ search: search || undefined, page: 1, pageSize: 6 });
  const items = (data?.items ?? []).filter((b) => b.status !== 'DRAFT');
  return (
    <div>
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
        <Input autoFocus className="pl-9" placeholder={t('billing.newInvoice.bookingSearch')} value={term} onChange={(e) => setTerm(e.target.value)} aria-label={t('billing.newInvoice.bookingSearch')} />
      </div>
      <ul className="mt-2 divide-y divide-border rounded border border-border">
        {isFetching && !data && <li className="px-3 py-2 text-sm text-ink/50">{t('common.loading')}</li>}
        {data && items.length === 0 && <li className="px-3 py-2 text-sm text-ink/50">{t('billing.newInvoice.noBookings')}</li>}
        {items.map((b) => (
          <li key={b.id}>
            <button type="button" onClick={() => onPick(b.id)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-paper">
              <span className="min-w-0 text-sm">
                <span className="font-medium tabular-nums text-ink">{b.reference}</span>
                <span className="ml-2 text-ink/60">
                  {b.clientName} · {b.caregiverName}
                </span>
                <span className="block text-xs text-ink/50">
                  {fmtDate(b.startDate, locale)} – {fmtDate(b.endDate, locale)}
                </span>
              </span>
              <BookingStatusBadge status={b.status} label={t(`bookings.status.${b.status}`)} />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

// useSearchParams needs a Suspense boundary for the static build.
export default function NewInvoicePage() {
  return (
    <Suspense>
      <NewInvoice />
    </Suspense>
  );
}
