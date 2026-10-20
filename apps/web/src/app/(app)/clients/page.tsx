'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search, SlidersHorizontal } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { ApiError } from '@/lib/api/client';
import { useClients, useDeleteClient } from '@/lib/hooks/use-clients';
import { useLocationTree } from '@/lib/hooks/use-caregivers';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { ListPagination } from '@/components/ui/list-pagination';
import {
  ClientFilterChips,
  ClientFiltersPanel,
  EMPTY_CLIENT_FILTERS,
  countClientFilters,
  toClientApiFilters,
  type ClientIntakeFilters,
} from '@/components/clients/client-filters';
import { CLIENT_STATUS_OPTIONS } from '@/lib/client-status';
import { useInitialParam } from '@/lib/use-initial-param';

/**
 * Staff view of self-registered patients/guardians. Mirrors the Caregivers
 * list on purpose - same toolbar (search, status, Filters), same chips, same
 * row actions and the same delete dialog - so staff move between the two
 * without relearning anything. Differences are only where the API differs:
 * deleting a client is ADMIN-only (@Roles on PatientsController.remove).
 *
 * The name opens /clients/[id], like a caregiver's registration number does.
 * That page reads the unmasked detail endpoint (and is audited); the list
 * rows carry the masked phone.
 */
export default function ClientsListPage() {
  const { t, locale } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  useInitialParam('status', CLIENT_STATUS_OPTIONS, setStatus);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState<ClientIntakeFilters>(EMPTY_CLIENT_FILTERS);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  // The API gates this module to ADMIN + STAFF (see @Roles on
  // PatientsController). The shared (app) layout only bounces CAREGIVER, so
  // a VERIFIER can otherwise reach this page and meet a wall of 403s.
  useEffect(() => {
    if (authLoading) return;
    if (user && user.role !== 'ADMIN' && user.role !== 'STAFF') {
      router.replace('/dashboard');
    }
  }, [authLoading, user, router]);

  const { data: tree } = useLocationTree(locale);
  const districts = useMemo(() => (tree ?? []).flatMap((p) => p.districts), [tree]);

  const activeCount = countClientFilters(filters);

  const { data, isLoading } = useClients({
    search: search || undefined,
    status: status || undefined,
    ...toClientApiFilters(filters),
    page,
    pageSize: 15,
  });

  const deleteMutation = useDeleteClient();

  const isAdmin = user?.role === 'ADMIN';
  const canEdit = isAdmin || user?.role === 'STAFF';
  const colSpan = canEdit ? 7 : 6;

  if (authLoading || !user || (user.role !== 'ADMIN' && user.role !== 'STAFF')) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">
        <span>{t('common.loading')}</span>
      </div>
    );
  }

  /** Any filter change resets to page 1 - staying on page 4 of a newly
   *  narrowed result set would show an empty table that looks like no data. */
  const updateFilters = (next: ClientIntakeFilters) => {
    setFilters(next);
    setPage(1);
  };

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">{t('clients.title')}</h1>
      </div>
      <p className="mb-6 text-sm text-ink/60">{t('clients.subtitle')}</p>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
          <Input
            placeholder={t('clients.search')}
            className="pl-9"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
          />
        </div>
        <Select
          className="sm:w-56"
          value={status}
          aria-label={t('clients.table.status')}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('filters.allStatuses')}</option>
          {CLIENT_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {t(`clients.status.${s}`)}
            </option>
          ))}
        </Select>
        <Button
          type="button"
          variant={activeCount > 0 ? 'primary' : 'secondary'}
          onClick={() => setFiltersOpen((o) => !o)}
          className="relative sm:w-auto"
        >
          <SlidersHorizontal size={15} />
          {t('filters.button')}
          {activeCount > 0 && (
            <span className="ml-1 rounded-full bg-white/25 px-1.5 py-0.5 text-[10px] font-semibold">{activeCount}</span>
          )}
        </Button>
      </div>

      {filtersOpen && (
        <div className="mb-4">
          <ClientFiltersPanel
            filters={filters}
            districts={districts}
            onChange={updateFilters}
            onClose={() => setFiltersOpen(false)}
          />
        </div>
      )}

      <ClientFilterChips filters={filters} districts={districts} onChange={updateFilters} />

      <div className="overflow-hidden rounded-lg border border-border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-paper text-xs uppercase tracking-wide text-ink/50">
            <tr>
              <th className="px-4 py-3 font-medium">{t('clients.table.name')}</th>
              <th className="px-4 py-3 font-medium">{t('clients.table.phone')}</th>
              <th className="px-4 py-3 font-medium">{t('clients.table.email')}</th>
              <th className="px-4 py-3 font-medium">{t('clients.table.care')}</th>
              <th className="px-4 py-3 font-medium">{t('clients.table.status')}</th>
              <th className="px-4 py-3 font-medium">{t('clients.table.registered')}</th>
              {canEdit && <th className="px-4 py-3 font-medium">{t('common.actions')}</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={colSpan} className="px-4 py-8 text-center text-ink/50">
                  {t('common.loading')}
                </td>
              </tr>
            )}
            {!isLoading && data?.items.length === 0 && (
              <tr>
                <td colSpan={colSpan} className="px-4 py-8 text-center text-ink/50">
                  {t('clients.empty')}
                </td>
              </tr>
            )}
            {data?.items.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0 hover:bg-paper">
                <td className="px-4 py-3">
                  <Link href={`/clients/${c.id}`} className="font-medium text-brand-dark hover:underline">
                    {c.fullName}
                  </Link>
                  {/* A guardian registers under their own name but is arranging
                      care for someone else - show who it is for. */}
                  {c.registrantType === 'GUARDIAN' && c.recipientName && (
                    <div className="text-xs text-ink/50">
                      {t('clients.forRecipient')} {c.recipientName}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="tabular-nums text-ink/70">{c.phone || c.accountPhone || '—'}</div>
                  {c.preferredContactMethod && (
                    <div className="text-xs text-ink/50">
                      {t(`clients.options.contactMethod.${c.preferredContactMethod}`)}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-ink/70">{c.email || '—'}</td>
                <td className="px-4 py-3 text-ink/70">
                  {c.careSchedule ? t(`clients.options.careSchedule.${c.careSchedule}`) : '—'}
                  {c.careStart && (
                    <div className="text-xs text-ink/50">{t(`clients.options.careStart.${c.careStart}`)}</div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <StatusBadge status={c.status} label={t(`clients.status.${c.status}`)} />
                </td>
                <td className="px-4 py-3 text-ink/70">{new Date(c.createdAt).toLocaleDateString()}</td>
                {canEdit && (
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link href={`/clients/${c.id}?edit=1`} className="text-sm text-brand-dark hover:underline">
                        {t('common.edit')}
                      </Link>
                      {/* Deleting a client account stays admin-only, matching the API. */}
                      {isAdmin && (
                        <button
                          onClick={() => {
                            deleteMutation.reset();
                            setDeleteTarget({ id: c.id, name: c.fullName });
                          }}
                          className="text-sm text-danger hover:underline"
                        >
                          {t('common.delete')}
                        </button>
                      )}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {deleteTarget && (
        <ConfirmDialog
          title={t('clients.deleteTitle')}
          message={t('clients.confirmDelete', { name: deleteTarget.name })}
          tone="danger"
          confirmLabel={t('common.delete')}
          pending={deleteMutation.isPending}
          error={deleteMutation.error instanceof ApiError ? deleteMutation.error.message : deleteMutation.error ? t('common.actionFailed') : null}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id, { onSuccess: () => setDeleteTarget(null) })}
        />
      )}

      {data && (
        <ListPagination
          page={data.page}
          totalPages={data.totalPages}
          total={data.total}
          noun={t('clients.clientsCount')}
          onPage={setPage}
        />
      )}
    </div>
  );
}
