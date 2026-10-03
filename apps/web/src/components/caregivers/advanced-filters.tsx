'use client';

import { useMemo, useState } from 'react';
import { SlidersHorizontal, X } from 'lucide-react';
import { useSkills, useLanguages, useLocationTree, useCities } from '@/lib/hooks/use-caregivers';
import { Button } from '@/components/ui/button';
import { Select, Label } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { CaregiverSearchFilters } from '@/lib/api/types';

export interface AdvancedFilters {
  gender?: string;
  skillIds: string[];
  languageIds: string[];
  /** City ids. The API filters on them; the picker below goes via district
   *  because 2155 city pills is not a filter, it is a list. */
  locationIds: number[];
  /** Which district the picker is currently narrowed to. Client-side only -
   *  it is not a filter, but the list page needs it to label the chips above
   *  the table without refetching every city's name. */
  locationDistrictId?: number;
  dayDuty?: boolean;
  nightDuty?: boolean;
  liveIn24h?: boolean;
}

export const EMPTY_ADVANCED_FILTERS: AdvancedFilters = {
  gender: undefined,
  skillIds: [],
  languageIds: [],
  locationIds: [],
  dayDuty: false,
  nightDuty: false,
  liveIn24h: false,
};

export function countActiveFilters(filters: AdvancedFilters): number {
  return (
    filters.skillIds.length +
    filters.languageIds.length +
    filters.locationIds.length +
    (filters.gender ? 1 : 0) +
    (filters.dayDuty ? 1 : 0) +
    (filters.nightDuty ? 1 : 0) +
    (filters.liveIn24h ? 1 : 0)
  );
}

export function toApiFilters(filters: AdvancedFilters): Partial<CaregiverSearchFilters> {
  return {
    gender: filters.gender || undefined,
    skillIds: filters.skillIds.length ? filters.skillIds : undefined,
    languageIds: filters.languageIds.length ? filters.languageIds : undefined,
    locationIds: filters.locationIds.length ? filters.locationIds : undefined,
    dayDuty: filters.dayDuty || undefined,
    nightDuty: filters.nightDuty || undefined,
    liveIn24h: filters.liveIn24h || undefined,
  };
}

function toggle<T>(list: T[], id: T): T[] {
  return list.includes(id) ? list.filter((x) => x !== id) : [...list, id];
}

function CheckboxPill({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <label
      className={cn(
        'flex cursor-pointer items-center gap-2 rounded border px-2.5 py-1.5 text-xs transition-colors',
        checked ? 'border-brand bg-brand-light text-brand-dark' : 'border-border bg-white text-ink/70 hover:bg-paper',
      )}
    >
      <input type="checkbox" checked={checked} onChange={onChange} className="h-3.5 w-3.5 rounded border-border text-brand focus:ring-brand" />
      {label}
    </label>
  );
}

export function AdvancedFiltersPanel({
  filters,
  onChange,
  onClose,
}: {
  filters: AdvancedFilters;
  onChange: (next: AdvancedFilters) => void;
  onClose: () => void;
}) {
  const { data: skills, isLoading: skillsLoading } = useSkills();
  const { data: languages, isLoading: languagesLoading } = useLanguages();
  const { data: tree, isLoading: treeLoading } = useLocationTree();
  const districts = useMemo(() => (tree ?? []).flatMap((p) => p.districts), [tree]);
  // Cities are only shown for a district the user has actually narrowed to:
  // fetching every district's cities up front would pull all 2155 rows into
  // a filter panel.
  // Lifted into the filter object rather than kept local: the caregivers list
  // renders a chip for each selected city and has no other way to name them.
  const districtFilter = filters.locationDistrictId ?? null;
  const setDistrictFilter = (id: number | null) => onChange({ ...filters, locationDistrictId: id ?? undefined });
  const { data: cities, isLoading: citiesLoading } = useCities(districtFilter, 'en');

  const activeCount = countActiveFilters(filters);

  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <SlidersHorizontal size={15} />
          Advanced filters
          {activeCount > 0 && (
            <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-white">{activeCount}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {activeCount > 0 && (
            <button
              type="button"
              onClick={() => onChange(EMPTY_ADVANCED_FILTERS)}
              className="text-xs font-medium text-ink/50 hover:text-danger"
            >
              Clear all
            </button>
          )}
          <button type="button" onClick={onClose} className="text-ink/40 hover:text-ink">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-4">
        <div>
          <Label>Gender</Label>
          <Select value={filters.gender ?? ''} onChange={(e) => onChange({ ...filters, gender: e.target.value || undefined })}>
            <option value="">Any</option>
            <option value="MALE">Male</option>
            <option value="FEMALE">Female</option>
            <option value="OTHER">Other</option>
          </Select>

          <div className="mt-4">
            <Label>Availability</Label>
            <div className="flex flex-col gap-2">
              <CheckboxPill
                checked={!!filters.dayDuty}
                label="Day duty"
                onChange={() => onChange({ ...filters, dayDuty: !filters.dayDuty })}
              />
              <CheckboxPill
                checked={!!filters.nightDuty}
                label="Night duty"
                onChange={() => onChange({ ...filters, nightDuty: !filters.nightDuty })}
              />
              <CheckboxPill
                checked={!!filters.liveIn24h}
                label="24-hour live-in"
                onChange={() => onChange({ ...filters, liveIn24h: !filters.liveIn24h })}
              />
            </div>
          </div>
        </div>

        <div>
          <Label>
            Skills {filters.skillIds.length > 0 && <span className="font-normal text-ink/40">(must have all selected)</span>}
          </Label>
          <div className="flex max-h-52 flex-wrap gap-1.5 overflow-y-auto pr-1">
            {skillsLoading && <span className="text-xs text-ink/40">Loading…</span>}
            {skills?.map((s) => (
              <CheckboxPill
                key={s.id}
                checked={filters.skillIds.includes(s.id)}
                label={s.name}
                onChange={() => onChange({ ...filters, skillIds: toggle(filters.skillIds, s.id) })}
              />
            ))}
          </div>
        </div>

        <div>
          <Label>
            Languages {filters.languageIds.length > 0 && <span className="font-normal text-ink/40">(must speak all selected)</span>}
          </Label>
          <div className="flex max-h-52 flex-wrap gap-1.5 overflow-y-auto pr-1">
            {languagesLoading && <span className="text-xs text-ink/40">Loading…</span>}
            {languages?.map((l) => (
              <CheckboxPill
                key={l.id}
                checked={filters.languageIds.includes(l.id)}
                label={l.name}
                onChange={() => onChange({ ...filters, languageIds: toggle(filters.languageIds, l.id) })}
              />
            ))}
          </div>
        </div>

        <div>
          <Label>
            Locations {filters.locationIds.length > 0 && <span className="font-normal text-ink/40">(any selected)</span>}
          </Label>
          <div className="flex max-h-32 flex-wrap gap-1.5 overflow-y-auto pr-1">
            {treeLoading && <span className="text-xs text-ink/40">Loading…</span>}
            {districts.map((d) => (
              <button
                key={d.id}
                type="button"
                aria-pressed={districtFilter === d.id}
                onClick={() => setDistrictFilter(districtFilter === d.id ? null : d.id)}
                className={
                  districtFilter === d.id
                    ? 'rounded-full border border-brand bg-brand px-2.5 py-1 text-xs text-white'
                    : 'rounded-full border border-border bg-white px-2.5 py-1 text-xs text-ink/70 hover:border-brand'
                }
              >
                {d.name}
              </button>
            ))}
          </div>
          <div className="mt-2 flex max-h-52 flex-wrap gap-1.5 overflow-y-auto pr-1">
            {!districtFilter && (
              <span className="text-xs text-ink/40">Pick a district to narrow to its cities.</span>
            )}
            {districtFilter && citiesLoading && <span className="text-xs text-ink/40">Loading…</span>}
            {districtFilter &&
              cities?.map((c) => (
                <CheckboxPill
                  key={c.id}
                  checked={filters.locationIds.includes(c.id)}
                  label={c.subName ? `${c.name} - ${c.subName}` : c.name}
                  onChange={() => onChange({ ...filters, locationIds: toggle(filters.locationIds, c.id) })}
                />
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
