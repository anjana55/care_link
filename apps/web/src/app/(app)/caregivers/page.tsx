'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowDownUp, Plus, Search, SlidersHorizontal } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '@/lib/i18n/provider';
import { useCaregivers, useSkills, useLanguages, useLocationTree } from '@/lib/hooks/use-caregivers';
import { useAuth } from '@/lib/api/auth-context';
import { api, ApiError } from '@/lib/api/client';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { FilterChip } from '@/components/ui/filter-chip';
import { ListPagination } from '@/components/ui/list-pagination';
import {
  AdvancedFiltersPanel,
  EMPTY_ADVANCED_FILTERS,
  countActiveFilters,
  toApiFilters,
  type AdvancedFilters,
} from '@/components/caregivers/advanced-filters';
import { CAREGIVER_STATUS_OPTIONS } from '@/lib/caregiver-status';
import { useInitialParam } from '@/lib/use-initial-param';

export default function CaregiversListPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  useInitialParam('status', CAREGIVER_STATUS_OPTIONS, setStatus);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [advanced, setAdvanced] = useState<AdvancedFilters>(EMPTY_ADVANCED_FILTERS);
  const [deleteTarget, setDeleteTarget] = useState<{ id: string; name: string } | null>(null);

  const { data: skills } = useSkills();
  const { data: languages } = useLanguages();
  const { data: tree } = useLocationTree();

  const activeCount = countActiveFilters(advanced);

  const { data, isLoading } = useCaregivers({
    search: search || undefined,
    status: status || undefined,
    page,
    pageSize: 15,
    ...toApiFilters(advanced),
  });

  const nameOf = useMemo(() => {
    const skillNames = new Map((skills ?? []).map((s) => [s.id, s.name]));
    const languageNames = new Map((languages ?? []).map((l) => [l.id, l.name]));
    const districtNames = new Map((tree ?? []).flatMap((p) => p.districts).map((d) => [d.id, d.name]));
    return { skill: skillNames, language: languageNames, location: districtNames };
  }, [skills, languages, tree]);

  const updateAdvanced = (next: AdvancedFilters) => {
    setAdvanced(next);
    setPage(1);
  };

  const removeChip = (kind: 'skillIds' | 'languageIds', id: string) => {
    updateAdvanced({ ...advanced, [kind]: advanced[kind].filter((x) => x !== id) });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/caregivers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['caregivers'] });
      setDeleteTarget(null);
    },
  });

  const isAdminOrStaff = user?.role === 'ADMIN' || user?.role === 'STAFF';

  return (
    <div>
      <div className="mb-2 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">{t('caregivers.title')}</h1>
        <div className="flex items-center gap-2">
          {user?.role === 'ADMIN' && (
            <Link href="/settings/import-export">
              <Button variant="secondary">
                <ArrowDownUp size={16} />
                {t('dataTransfer.button')}
              </Button>
            </Link>
          )}
          <Link href="/caregivers/new">
            <Button>
              <Plus size={16} />
              {t('caregivers.addNew')}
            </Button>
          </Link>
        </div>
      </div>
      <p className="mb-6 text-sm text-ink/60">{t('caregivers.subtitle')}</p>

      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
          <Input
            placeholder={t('caregivers.search')}
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
          aria-label={t('caregivers.table.status')}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('filters.allStatuses')}</option>
          {CAREGIVER_STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {t(`caregivers.status.${s}`)}
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
          <AdvancedFiltersPanel filters={advanced} onChange={updateAdvanced} onClose={() => setFiltersOpen(false)} />
        </div>
      )}

      {activeCount > 0 && (
        <div className="mb-4 flex flex-wrap items-center gap-2">
          {advanced.gender && (
            <FilterChip label={`Gender: ${advanced.gender}`} onRemove={() => updateAdvanced({ ...advanced, gender: undefined })} />
          )}
          {advanced.dayDuty && <FilterChip label="Day duty" onRemove={() => updateAdvanced({ ...advanced, dayDuty: false })} />}
          {advanced.nightDuty && <FilterChip label="Night duty" onRemove={() => updateAdvanced({ ...advanced, nightDuty: false })} />}
          {advanced.liveIn24h && (
            <FilterChip label="24-hour live-in" onRemove={() => updateAdvanced({ ...advanced, liveIn24h: false })} />
          )}
          {advanced.skillIds.map((id) => (
            <FilterChip key={id} label={nameOf.skill.get(id) ?? id} onRemove={() => removeChip('skillIds', id)} />
          ))}
          {advanced.languageIds.map((id) => (
            <FilterChip key={id} label={nameOf.language.get(id) ?? id} onRemove={() => removeChip('languageIds', id)} />
          ))}
          {advanced.locationIds.length > 0 && (
            <FilterChip
              label={
                advanced.locationDistrictId
                  ? `${nameOf.location.get(advanced.locationDistrictId) ?? ''} (${advanced.locationIds.length})`
                  : `${advanced.locationIds.length} cities`
              }
              onRemove={() =>
                updateAdvanced({ ...advanced, locationIds: [], locationDistrictId: undefined })
              }
            />
          )}
          <button onClick={() => updateAdvanced(EMPTY_ADVANCED_FILTERS)} className="text-xs font-medium text-ink/40 hover:text-danger">
            {t('filters.clearAll')}
          </button>
        </div>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-paper text-xs uppercase tracking-wide text-ink/50">
            <tr>
              <th className="px-4 py-3 font-medium">{t('caregivers.table.registrationNumber')}</th>
              <th className="px-4 py-3 font-medium">{t('caregivers.table.name')}</th>
              <th className="px-4 py-3 font-medium">{t('caregivers.table.phone')}</th>
              <th className="px-4 py-3 font-medium">{t('caregivers.table.skills')}</th>
              <th className="px-4 py-3 font-medium">{t('caregivers.table.languages')}</th>
              <th className="px-4 py-3 font-medium">Locations</th>
              <th className="px-4 py-3 font-medium">{t('caregivers.table.status')}</th>
              {isAdminOrStaff && <th className="px-4 py-3 font-medium">{t('common.actions')}</th>}
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={isAdminOrStaff ? 8 : 7} className="px-4 py-8 text-center text-ink/50">
                  {t('common.loading')}
                </td>
              </tr>
            )}
            {!isLoading && data?.items.length === 0 && (
              <tr>
                <td colSpan={isAdminOrStaff ? 8 : 7} className="px-4 py-8 text-center text-ink/50">
                  {t('caregivers.empty')}
                </td>
              </tr>
            )}
            {data?.items.map((c) => (
              <tr key={c.id} className="border-b border-border last:border-0 hover:bg-paper">
                <td className="px-4 py-3">
                  <Link href={`/caregivers/${c.id}`} className="font-medium text-brand-dark hover:underline">
                    {c.registrationNumber}
                  </Link>
                </td>
                <td className="px-4 py-3 text-ink">{c.fullName}</td>
                <td className="px-4 py-3 tabular-nums text-ink/70">{c.primaryPhone}</td>
                <td className="px-4 py-3 text-ink/70">{c.skills.slice(0, 2).join(', ') || '—'}</td>
                <td className="px-4 py-3 text-ink/70">{c.languages.join(', ') || '—'}</td>
                <td className="px-4 py-3 text-ink/70">{c.locations.join(', ') || '—'}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={c.status} label={t(`caregivers.status.${c.status}`)} />
                </td>
                {isAdminOrStaff && (
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Link href={`/caregivers/${c.id}?edit=1`} className="text-sm text-brand-dark hover:underline">
                        {t('common.edit')}
                      </Link>
                      <button
                        onClick={() => {
                          deleteMutation.reset();
                          setDeleteTarget({ id: c.id, name: c.fullName });
                        }}
                        className="text-sm text-danger hover:underline"
                      >
                        {t('common.delete')}
                      </button>
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
          title={t('caregivers.deleteTitle')}
          message={t('caregivers.confirmDeleteNamed', { name: deleteTarget.name })}
          tone="danger"
          confirmLabel={t('common.delete')}
          pending={deleteMutation.isPending}
          error={deleteMutation.error instanceof ApiError ? deleteMutation.error.message : deleteMutation.error ? t('common.actionFailed') : null}
          onCancel={() => setDeleteTarget(null)}
          onConfirm={() => deleteMutation.mutate(deleteTarget.id)}
        />
      )}

      {data && (
        <ListPagination
          page={data.page}
          totalPages={data.totalPages}
          total={data.total}
          noun={t('caregivers.countNoun')}
          onPage={setPage}
        />
      )}
    </div>
  );
}

