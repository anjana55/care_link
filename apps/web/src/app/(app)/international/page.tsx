'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { useInternationalSummary } from '@/lib/hooks/use-international';
import { useInitialParam } from '@/lib/use-initial-param';
import { EnquiriesTab } from '@/components/international/enquiries-tab';
import { SharedProfilesTab } from '@/components/international/shared-profiles-tab';
import { EmployersTab } from '@/components/international/employers-tab';
import { TalentPoolTab } from '@/components/international/talent-pool-tab';
import { InterviewRequestsTab } from '@/components/international/interview-requests-tab';
import { VacanciesTab } from '@/components/international/vacancies-tab';
import { PlacementsTab } from '@/components/international/placements-tab';
import { InvoicesTab } from '@/components/international/invoices-tab';
import { ExpiringTab } from '@/components/international/expiring-tab';
import { OffersTab } from '@/components/international/offers-tab';
import { WelfareTab } from '@/components/international/welfare-tab';
import { ResultsTab } from '@/components/international/results-tab';
import { ReportsTab } from '@/components/international/reports-tab';
import { cn } from '@/lib/utils';

const TABS = ['enquiries', 'interviews', 'offers', 'vacancies', 'placements', 'welfare', 'invoices', 'employers', 'pool', 'results', 'expiring', 'profiles', 'reports'] as const;
type Tab = (typeof TABS)[number];

/**
 * Overseas: the staff side of the international paths. Employer enquiries
 * (worked like the Requests queue), interviews, job offers to review, the
 * vacancy board and its applicants, placements with their welfare check-ins,
 * welfare reports and SOS from caregivers abroad, placement-fee invoices,
 * employer accounts to verify, the talent pool, test results to verify,
 * expiring passports and documents, shared profiles waiting for review, and
 * reports. Training has its own page (/training).
 * ADMIN and STAFF, like Requests.
 */
export default function InternationalPage() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState<Tab>('enquiries');
  useInitialParam('tab', TABS, setTab);

  // Training moved to its own menu; old links (?tab=training) still land there.
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') === 'training') router.replace('/training');
  }, [router]);

  useEffect(() => {
    if (loading) return;
    if (user && user.role !== 'ADMIN' && user.role !== 'STAFF') router.replace('/dashboard');
  }, [loading, user, router]);

  const allowed = user?.role === 'ADMIN' || user?.role === 'STAFF';
  const { data: summary } = useInternationalSummary(allowed);

  if (loading || !allowed) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;
  }

  const counts: Partial<Record<Tab, number>> = {
    enquiries: summary?.new,
    interviews: summary?.interviewRequests,
    vacancies: summary ? summary.pendingVacancies + summary.newApplications : undefined,
    placements: summary?.overdueCheckins,
    invoices: summary?.overdueInvoices,
    employers: summary?.pendingEmployers,
    profiles: summary?.pendingProfiles,
    offers: summary?.pendingOffers,
    welfare: summary?.openWelfare,
    results: summary?.pendingAssessments,
  };
  const badge = (key: Tab) => counts[key];

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
              {!!n && (
                <span className={cn('rounded-full px-1.5 text-xs font-semibold tabular-nums text-white', key === 'welfare' && summary?.urgentWelfare ? 'bg-danger' : 'bg-accent')}>
                  {n}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {tab === 'enquiries' && <EnquiriesTab />}
      {tab === 'interviews' && <InterviewRequestsTab />}
      {tab === 'vacancies' && <VacanciesTab />}
      {tab === 'placements' && <PlacementsTab />}
      {tab === 'invoices' && <InvoicesTab />}
      {tab === 'expiring' && <ExpiringTab />}
      {tab === 'employers' && <EmployersTab />}
      {tab === 'pool' && <TalentPoolTab />}
      {tab === 'profiles' && <SharedProfilesTab />}
      {tab === 'offers' && <OffersTab />}
      {tab === 'welfare' && <WelfareTab />}
      {tab === 'results' && <ResultsTab />}
      {tab === 'reports' && <ReportsTab />}
    </div>
  );
}
