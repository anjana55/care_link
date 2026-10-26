'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { useInternationalSummary } from '@/lib/hooks/use-international';
import { useInitialParam } from '@/lib/use-initial-param';
import { EnquiriesTab } from '@/components/international/enquiries-tab';
import { SharedProfilesTab } from '@/components/international/shared-profiles-tab';
import { TrainingTab } from '@/components/international/training-tab';
import { cn } from '@/lib/utils';

const TABS = ['enquiries', 'profiles', 'training'] as const;
type Tab = (typeof TABS)[number];

/**
 * Overseas: the staff side of the international paths. Employer enquiries
 * (worked like the Requests queue), shared caregiver profiles waiting for
 * review, and the training programmes caregivers sign up for.
 * ADMIN and STAFF, like Requests.
 */
export default function InternationalPage() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('enquiries');
  useInitialParam('tab', TABS, setTab);

  useEffect(() => {
    if (loading) return;
    if (user && user.role !== 'ADMIN' && user.role !== 'STAFF') router.replace('/dashboard');
  }, [loading, user, router]);

  const allowed = user?.role === 'ADMIN' || user?.role === 'STAFF';
  const { data: summary } = useInternationalSummary(allowed);

  if (loading || !allowed) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;
  }

  const badge = (key: Tab) => (key === 'enquiries' ? summary?.new : key === 'profiles' ? summary?.pendingProfiles : undefined);

  return (
    <div>
      <h1 className="mb-2 text-xl font-semibold text-ink">{t('international.title')}</h1>
      <p className="mb-6 text-sm text-ink/60">{t('international.subtitle')}</p>

      <div className="mb-5 flex gap-1 overflow-x-auto border-b border-border" role="tablist">
        {TABS.map((key) => {
          const n = badge(key);
          return (
            <button
              key={key}
              role="tab"
              aria-selected={tab === key}
              onClick={() => setTab(key)}
              className={cn(
                '-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                tab === key ? 'border-brand text-brand-dark' : 'border-transparent text-ink/60 hover:text-ink',
              )}
            >
              {t(`international.tabs.${key}`)}
              {!!n && <span className="rounded-full bg-accent px-1.5 text-xs font-semibold tabular-nums text-white">{n}</span>}
            </button>
          );
        })}
      </div>

      {tab === 'enquiries' && <EnquiriesTab />}
      {tab === 'profiles' && <SharedProfilesTab />}
      {tab === 'training' && <TrainingTab />}
    </div>
  );
}
