'use client';

import { useEffect, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Phone, PhoneCall, Search } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { useCareRequests, useCareRequestSummary, type CareRequestFilters } from '@/lib/hooks/use-care-requests';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { RequestStatusBadge } from '@/components/requests/request-status-badge';
import { cn } from '@/lib/utils';
import type { CareRequestStatus } from '@/lib/api/types';
import { useInitialParam } from '@/lib/use-initial-param';

/** The queue's tabs: open work first, then each finished state, then everything. */
const TABS: { key: string; filter: Pick<CareRequestFilters, 'scope' | 'status' | 'unmatched'> }[] = [
  { key: 'open', filter: { scope: 'open' } },
  // Open requests with no caregiver yet - usually phone requests waiting for a match.
  { key: 'unmatched', filter: { scope: 'open', unmatched: true } },
  { key: 'INTRODUCED', filter: { status: 'INTRODUCED' } },
  { key: 'CLOSED', filter: { status: 'CLOSED' } },
  { key: 'CANCELLED', filter: { status: 'CANCELLED' } },
  { key: 'all', filter: {} },
];

/**
 * The staff Requests queue: clients asking to be put in touch with a caregiver.
 * Open requests come first, oldest waiting at the top, so the list reads as
 * "what to do next". ADMIN and STAFF only, like the Clients list.
 */
export default function RequestsPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [tab, setTab] = useState('open');
  const [search, setSearch] = useState('');
  const [assigned, setAssigned] = useState('');
  const [page, setPage] = useState(1);
  // The dashboard links here with ?tab=... (e.g. open requests waiting).
  useInitialParam('tab', TABS.map((x) => x.key), setTab);

  useEffect(() => {
    if (authLoading) return;
    if (user && user.role !== 'ADMIN' && user.role !== 'STAFF') router.replace('/dashboard');
  }, [authLoading, user, router]);

  const allowed = user?.role === 'ADMIN' || user?.role === 'STAFF';
  const { data: summary } = useCareRequestSummary(allowed);
  const { data, isLoading } = useCareRequests(
    {
      ...TABS.find((x) => x.key === tab)!.filter,
      search: search.trim() || undefined,
      assigned: (assigned || undefined) as CareRequestFilters['assigned'],
      page,
      pageSize: 20,
    },
    allowed,
  );

  if (authLoading || !allowed) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">
        <span>{t('common.loading')}</span>
      </div>
    );
  }

  const filter = (setter: (v: string) => void) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setter(e.target.value);
    setPage(1);
  };
  const count = (key: string) => {
    if (!summary) return null;
    if (key === 'open') return summary.open;
    if (key === 'unmatched') return summary.unmatched;
    if (key === 'all') return null;
    return summary.byStatus[key as CareRequestStatus];
  };

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">{t('requests.title')}</h1>
        <Link
          href="/requests/new"
          className="inline-flex h-9 items-center gap-2 rounded bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark"
        >
          <PhoneCall size={16} aria-hidden />
          {t('requests.newPhoneRequest')}
        </Link>
      </div>
      <p className="mb-6 text-sm text-ink/60">{t('requests.subtitle')}</p>

      <div className="mb-4 flex gap-1 overflow-x-auto border-b border-border" role="tablist">
        {TABS.map(({ key }) => {
          const active = tab === key;
          const n = count(key);
          return (
            <button
              key={key}
              role="tab"
              aria-selected={active}
              onClick={() => {
                setTab(key);
                setPage(1);
              }}
              className={cn(
                '-mb-px flex items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2 text-sm font-medium transition-colors',
                active ? 'border-brand text-brand-dark' : 'border-transparent text-ink/60 hover:text-ink',
              )}
            >
              {t(`requests.tabs.${key}`)}
              {n !== null && <span className="rounded-full bg-paper px-1.5 text-xs tabular-nums text-ink/60">{n}</span>}
            </button>
          );
        })}
      </div>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
          <Input placeholder={t('requests.search')} className="pl-9" value={search} onChange={filter(setSearch)} />
        </div>
        <Select className="sm:w-56" value={assigned} onChange={filter(setAssigned)} aria-label={t('requests.table.assigned')}>
          <option value="">{t('requests.assigned.any')}</option>
          <option value="me">{t('requests.assigned.me')}</option>
          <option value="unassigned">{t('requests.assigned.unassigned')}</option>
        </Select>
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-white">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead className="border-b border-border bg-paper text-xs uppercase tracking-wide text-ink/50">
            <tr>
              <th className="px-4 py-3 font-medium">{t('requests.table.reference')}</th>
              <th className="px-4 py-3 font-medium">{t('requests.table.client')}</th>
              <th className="px-4 py-3 font-medium">{t('requests.table.caregiver')}</th>
              <th className="px-4 py-3 font-medium">{t('requests.table.status')}</th>
              <th className="px-4 py-3 font-medium">{t('requests.table.assigned')}</th>
              <th className="px-4 py-3 font-medium">{t('requests.table.received')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink/50">
                  {t('common.loading')}
                </td>
              </tr>
            )}
            {!isLoading && data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink/50">
                  {t('requests.empty')}
                </td>
              </tr>
            )}
            {data?.items.map((r) => (
              <tr key={r.id} className="border-b border-border last:border-0 hover:bg-paper">
                <td className="px-4 py-3">
                  <Link href={`/requests/${r.id}`} className="font-medium tabular-nums text-brand-dark hover:underline">
                    {r.reference}
                  </Link>
                  {r.source === 'PHONE' && (
                    <span className="mt-0.5 flex items-center gap-1 text-xs text-ink/50">
                      <Phone size={12} aria-hidden />
                      {t('requests.source.PHONE')}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-ink">{r.clientName}</div>
                  {r.registrantType === 'GUARDIAN' && r.recipientName && (
                    <div className="text-xs text-ink/50">{t('requests.forRecipient', { name: r.recipientName })}</div>
                  )}
                  {r.clientStatus !== 'ACTIVE' && (
                    <div className="mt-1">
                      <StatusBadge status={r.clientStatus} label={t(`clients.status.${r.clientStatus}`)} />
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  {r.caregiverId ? (
                    <>
                      <div className="text-ink">{r.caregiverName}</div>
                      <div className="text-xs tabular-nums text-ink/50">
                        {r.caregiverRegistrationNumber}
                        {r.caregiverDeleted && <span className="ml-2 text-danger">{t('requests.caregiverRemoved')}</span>}
                      </div>
                    </>
                  ) : (
                    <span className="rounded bg-accent-light px-2 py-0.5 text-xs font-medium text-accent">{t('requests.notMatched')}</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <RequestStatusBadge status={r.status} label={t(`requests.status.${r.status}`)} />
                </td>
                <td className="px-4 py-3 text-ink/70">{r.assignedTo?.fullName ?? <span className="text-ink/40">{t('requests.unassigned')}</span>}</td>
                <td className="px-4 py-3 text-ink/70">{new Date(r.createdAt).toLocaleString()}</td>
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
