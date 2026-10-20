'use client';

import Link from 'next/link';
import { ArrowRight, FileWarning, ShieldCheck } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { useDashboardStats } from '@/lib/hooks/use-caregivers';
import { useAuth } from '@/lib/api/auth-context';
import { BusinessDashboard } from '@/components/dashboard/business-dashboard';
import { HBarList } from '@/components/dashboard/charts';

/**
 * ADMIN and STAFF get the business dashboard (money, demand, operations,
 * caregivers). A VERIFIER's job is the caregiver register, and the business
 * figures are not theirs to see, so they get the verification view.
 */
export default function DashboardPage() {
  const { user } = useAuth();
  if (user?.role === 'ADMIN' || user?.role === 'STAFF') return <BusinessDashboard />;
  return <VerifierDashboard />;
}

const PIPELINE = ['DRAFT', 'REGISTERED', 'DOCUMENTS_PENDING', 'UNDER_VERIFICATION', 'VERIFIED', 'ACTIVE'] as const;

function VerifierDashboard() {
  const { t } = useTranslation();
  const { data, isLoading } = useDashboardStats();

  return (
    <div className="viz mx-auto max-w-5xl space-y-5">
      <div>
        <h1 className="text-2xl font-bold tracking-tight text-ink">{t('dashboard.title')}</h1>
        <p className="mt-1 text-sm text-ink/60">{t('dashboard.verifierSubtitle')}</p>
      </div>

      {isLoading || !data ? (
        <p className="text-sm text-ink/50">{t('common.loading')}</p>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Link
              href="/caregivers?status=UNDER_VERIFICATION"
              className="group flex items-center gap-4 rounded-xl border border-border bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:border-brand"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-light text-accent">
                <ShieldCheck className="h-5 w-5" aria-hidden />
              </span>
              <span className="flex-1">
                <span className="block text-3xl font-bold tabular-nums text-ink">{data.awaitingVerification}</span>
                <span className="text-sm text-ink/60">{t('dashboard.awaitingVerification')}</span>
              </span>
              <ArrowRight className="h-5 w-5 text-ink/30 group-hover:text-ink/60" aria-hidden />
            </Link>
            <Link
              href="/caregivers?status=DOCUMENTS_PENDING"
              className="group flex items-center gap-4 rounded-xl border border-border bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)] hover:border-brand"
            >
              <span className="flex h-11 w-11 items-center justify-center rounded-full bg-accent-light text-accent">
                <FileWarning className="h-5 w-5" aria-hidden />
              </span>
              <span className="flex-1">
                <span className="block text-3xl font-bold tabular-nums text-ink">{data.documentsRequiringAttention}</span>
                <span className="text-sm text-ink/60">{t('dashboard.documentsRequiringAttention')}</span>
              </span>
              <ArrowRight className="h-5 w-5 text-ink/30 group-hover:text-ink/60" aria-hidden />
            </Link>
          </div>

          <section className="rounded-xl border border-border bg-white p-5 shadow-[0_1px_2px_rgba(0,0,0,0.03)]">
            <h2 className="text-sm font-semibold text-ink">{t('dashboard.pipeline.title')}</h2>
            <p className="mb-4 mt-0.5 text-xs text-ink/55">{t('dashboard.pipeline.subtitle')}</p>
            <HBarList
              ariaLabel={t('dashboard.pipeline.title')}
              rows={PIPELINE.map((key, i) => {
                const n = Number(data.byStatus?.[key] ?? 0);
                return { key, label: t(`caregivers.status.${key}`), value: n, display: String(n), color: `var(--viz-ramp-${Math.min(5, i + 1)})` };
              })}
            />
            <p className="mt-3 text-[11px] text-ink/50">
              {t('dashboard.totalCaregivers')}: <span className="font-semibold text-ink">{data.totalCaregivers}</span> · {t('dashboard.suspended')}:{' '}
              <span className="font-semibold text-ink">{data.suspended}</span>
            </p>
          </section>
        </>
      )}
    </div>
  );
}
