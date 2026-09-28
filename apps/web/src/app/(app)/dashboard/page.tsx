'use client';

import { useTranslation } from '@/lib/i18n/provider';
import { useDashboardStats } from '@/lib/hooks/use-caregivers';
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

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-ink">{t('dashboard.title')}</h1>

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
