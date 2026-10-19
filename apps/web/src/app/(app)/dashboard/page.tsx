'use client';

import { useTranslation } from '@/lib/i18n/provider';
import Link from 'next/link';
import { useDashboardStats } from '@/lib/hooks/use-caregivers';
import { useCareRequestSummary } from '@/lib/hooks/use-care-requests';
import { useBookingSummary } from '@/lib/hooks/use-bookings';
import { useAuth } from '@/lib/api/auth-context';
import { Card, CardContent } from '@/components/ui/card';

function StatCard({ label, value, tone }: { label: string; value: number; tone?: 'brand' | 'accent' | 'danger' }) {
  const toneClass = tone === 'brand' ? 'text-brand' : tone === 'accent' ? 'text-accent' : tone === 'danger' ? 'text-danger' : 'text-ink';
  return (
    <Card>
      <CardContent className="py-5">
        <div className={`tabular-nums text-3xl font-semibold ${toneClass}`}>{value}</div>
        <div className="mt-1 text-sm text-ink/60">{label}</div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { t } = useTranslation();
  const { data, isLoading } = useDashboardStats();
  const { user } = useAuth();
  const canSeeRequests = user?.role === 'ADMIN' || user?.role === 'STAFF';
  const { data: requests } = useCareRequestSummary(canSeeRequests);
  const { data: bookingSummary } = useBookingSummary(canSeeRequests);

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-ink">{t('dashboard.title')}</h1>

      {canSeeRequests && requests && (
        <Link href="/requests" className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          <StatCard label={t('dashboard.newRequests')} value={requests.new} tone={requests.new > 0 ? 'accent' : undefined} />
          <StatCard label={t('dashboard.openRequests')} value={requests.open} />
        </Link>
      )}
      {canSeeRequests && bookingSummary && (
        <Link href="/bookings" className="mb-4 grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          <StatCard label={t('dashboard.shiftsToday')} value={bookingSummary.shiftsToday} tone="brand" />
          <StatCard label={t('dashboard.draftBookings')} value={bookingSummary.byStatus.DRAFT} tone={bookingSummary.byStatus.DRAFT > 0 ? 'accent' : undefined} />
        </Link>
      )}

      {isLoading || !data ? (
        <p className="text-sm text-ink/50">{t('common.loading')}</p>
      ) : (
        <div className="grid grid-cols-2 gap-4 md:grid-cols-3 lg:grid-cols-4">
          <StatCard label={t('dashboard.totalCaregivers')} value={data.totalCaregivers} />
          <StatCard label={t('dashboard.pendingRegistration')} value={data.pendingRegistration} tone="accent" />
          <StatCard label={t('dashboard.awaitingVerification')} value={data.awaitingVerification} tone="accent" />
          <StatCard label={t('dashboard.verified')} value={data.verified} tone="brand" />
          <StatCard label={t('dashboard.active')} value={data.active} tone="brand" />
          <StatCard label={t('dashboard.suspended')} value={data.suspended} tone="danger" />
          <StatCard label={t('dashboard.documentsRequiringAttention')} value={data.documentsRequiringAttention} tone="accent" />
        </div>
      )}
    </div>
  );
}
