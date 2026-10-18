'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { CalendarPlus, Search } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { useBookings, useBookingSummary } from '@/lib/hooks/use-bookings';
import { fmtDate, fmtDateTime } from '@/lib/colombo-time';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { BookingStatusBadge } from '@/components/bookings/booking-badges';
import { cn } from '@/lib/utils';
import type { BookingStatus } from '@/lib/api/types';

const TABS: (BookingStatus | 'all')[] = ['CONFIRMED', 'DRAFT', 'COMPLETED', 'CANCELLED', 'all'];

/** Every booking, active ones first. ADMIN and STAFF. */
export default function BookingsPage() {
  const { t, locale } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<BookingStatus | 'all'>('CONFIRMED');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const allowed = user?.role === 'ADMIN' || user?.role === 'STAFF';

  useEffect(() => {
    if (!authLoading && user && !allowed) router.replace('/dashboard');
  }, [authLoading, user, allowed, router]);

  const { data: summary } = useBookingSummary(allowed);
  const { data, isLoading } = useBookings({ status: tab === 'all' ? undefined : tab, search: search.trim() || undefined, page, pageSize: 20 }, allowed);

  if (authLoading || !allowed) return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">{t('bookings.title')}</h1>
        <Link href="/bookings/new" className="inline-flex h-9 items-center gap-2 rounded bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark">
          <CalendarPlus size={16} aria-hidden />
          {t('bookings.newBooking')}
        </Link>
      </div>
      <p className="mb-6 text-sm text-ink/60">{t('bookings.subtitle')}</p>

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border" role="tablist">
        {TABS.map((key) => (
          <button
            key={key}
            role="tab"
            aria-selected={tab === key}
            onClick={() => {
              setTab(key);
              setPage(1);
            }}
            className={cn(
              '-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
              tab === key ? 'border-brand text-brand-dark' : 'border-transparent text-ink/60 hover:text-ink',
            )}
          >
            {t(`bookings.tabs.${key}`)}
            {summary && key !== 'all' && <span className="rounded-full bg-paper px-1.5 text-xs tabular-nums text-ink/60">{summary.byStatus[key]}</span>}
          </button>
        ))}
      </div>

      <div className="relative mb-4">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
        <Input
          placeholder={t('bookings.search')}
          className="pl-9"
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(1);
          }}
        />
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-white">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-border bg-paper text-xs uppercase tracking-wide text-ink/50">
            <tr>
              <th className="px-4 py-3 font-medium">{t('bookings.table.reference')}</th>
              <th className="px-4 py-3 font-medium">{t('bookings.table.client')}</th>
              <th className="px-4 py-3 font-medium">{t('bookings.table.caregiver')}</th>
              <th className="px-4 py-3 font-medium">{t('bookings.table.schedule')}</th>
              <th className="px-4 py-3 font-medium">{t('bookings.table.dates')}</th>
              <th className="px-4 py-3 font-medium">{t('bookings.table.next')}</th>
              <th className="px-4 py-3 font-medium">{t('bookings.table.status')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink/50">{t('common.loading')}</td>
              </tr>
            )}
            {!isLoading && data?.items.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-8 text-center text-ink/50">{t('bookings.empty')}</td>
              </tr>
            )}
            {data?.items.map((b) => (
              <tr key={b.id} className="border-b border-border last:border-0 hover:bg-paper">
                <td className="px-4 py-3">
                  <Link href={`/bookings/${b.id}`} className="font-medium tabular-nums text-brand-dark hover:underline">
                    {b.reference}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <div className="text-ink">{b.clientName}</div>
                  {b.recipientName && <div className="text-xs text-ink/50">{t('requests.forRecipient', { name: b.recipientName })}</div>}
                </td>
                <td className="px-4 py-3">
                  <div className="text-ink">{b.caregiverName}</div>
                  <div className="text-xs tabular-nums text-ink/50">{b.caregiverRegistrationNumber}</div>
                </td>
                <td className="px-4 py-3 text-ink/70">
                  {t(`bookings.scheduleType.${b.scheduleType}`)}
                  <div className="text-xs tabular-nums text-ink/50">
                    {b.shiftStartTime}–{b.shiftEndTime}
                  </div>
                </td>
                <td className="px-4 py-3 text-ink/70">
                  {fmtDate(b.startDate, locale)} – {fmtDate(b.endDate, locale)}
                </td>
                <td className="px-4 py-3 text-ink/70">{b.nextShiftAt ? fmtDateTime(b.nextShiftAt, locale) : '—'}</td>
                <td className="px-4 py-3">
                  <BookingStatusBadge status={b.status} label={t(`bookings.status.${b.status}`)} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-ink/60">
          <span>{t('requests.pageOf', { page: data.page, totalPages: data.totalPages })}</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              {t('clients.previous')}
            </Button>
            <Button variant="secondary" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
              {t('clients.next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
