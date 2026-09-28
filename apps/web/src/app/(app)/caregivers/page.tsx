'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { Plus, Search, SlidersHorizontal, X } from 'lucide-react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslation } from '@/lib/i18n/provider';
import { useCaregivers, useSkills, useLanguages, useLocations } from '@/lib/hooks/use-caregivers';
import { useAuth } from '@/lib/api/auth-context';
import { api } from '@/lib/api/client';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import {
  AdvancedFiltersPanel,
  EMPTY_ADVANCED_FILTERS,
  countActiveFilters,
  toApiFilters,
  type AdvancedFilters,
} from '@/components/caregivers/advanced-filters';
import type { CaregiverStatus } from '@/lib/api/types';
import { cn } from '@/lib/utils';

const STATUSES: CaregiverStatus[] = [
  'DRAFT',
  'REGISTERED',
  'DOCUMENTS_PENDING',
  'UNDER_VERIFICATION',
  'VERIFIED',
  'ACTIVE',
  'INACTIVE',
  'SUSPENDED',
  'REJECTED',
];

export default function CaregiversListPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [advanced, setAdvanced] = useState<AdvancedFilters>(EMPTY_ADVANCED_FILTERS);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  const { data: skills } = useSkills();
  const { data: languages } = useLanguages();
  const { data: locations } = useLocations();

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
    const locationNames = new Map((locations ?? []).map((l) => [l.id, l.city]));
    return { skill: skillNames, language: languageNames, location: locationNames };
  }, [skills, languages, locations]);

  const updateAdvanced = (next: AdvancedFilters) => {
    setAdvanced(next);
    setPage(1);
  };

  const removeChip = (kind: 'skillIds' | 'languageIds' | 'locationIds', id: string) => {
    updateAdvanced({ ...advanced, [kind]: advanced[kind].filter((x) => x !== id) });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/caregivers/${id}`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['caregivers'] });
      setDeleteConfirmId(null);
    },
  });

  const isAdminOrStaff = user?.role === 'ADMIN' || user?.role === 'STAFF';

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <h1 className="text-xl font-semibold text-ink">{t('caregivers.title')}</h1>
        <Link href="/caregivers/new">
          <Button>
            <Plus size={16} />
            {t('caregivers.addNew')}
          </Button>
        </Link>
      </div>

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
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          <option value="">{t('caregivers.table.status')}</option>
          {STATUSES.map((s) => (
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
          Filters
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
          {advanced.locationIds.map((id) => (
            <FilterChip key={id} label={nameOf.location.get(id) ?? id} onRemove={() => removeChip('locationIds', id)} />
          ))}
          <button onClick={() => updateAdvanced(EMPTY_ADVANCED_FILTERS)} className="text-xs font-medium text-ink/40 hover:text-danger">
            Clear all
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
              {isAdminOrStaff && <th className="px-4 py-3 font-medium">{t('common.edit')}</th>}
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
                        onClick={() => setDeleteConfirmId(c.id)}
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

      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30">
          <div className="w-full max-w-sm rounded-lg border border-border bg-white p-6">
            <h3 className="mb-2 text-base font-semibold text-ink">{t('caregivers.deleteTitle')}</h3>
            <p className="mb-4 text-sm text-ink/60">{t('caregivers.confirmDelete')}</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setDeleteConfirmId(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deleteConfirmId)}
              >
                {t('common.confirm')}
              </Button>
            </div>
          </div>
        </div>
      )}

      {data && data.totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-ink/60">
          <span>
            Page {data.page} of {data.totalPages} · {data.total} caregivers
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              {t('caregivers.wizard.back')}
            </Button>
            <Button variant="secondary" size="sm" disabled={page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}

function FilterChip({ label, onRemove }: { label: string; onRemove: () => void }) {
  return (
    <span className={cn('flex items-center gap-1.5 rounded-full bg-brand-light px-2.5 py-1 text-xs font-medium text-brand-dark')}>
      {label}
      <button onClick={onRemove} className="text-brand-dark/60 hover:text-brand-dark">
        <X size={12} />
      </button>
    </span>
  );
}
