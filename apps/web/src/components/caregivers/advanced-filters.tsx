'use client';

import { SlidersHorizontal, X } from 'lucide-react';
import { useSkills, useLanguages, useLocations } from '@/lib/hooks/use-caregivers';
import { Button } from '@/components/ui/button';
import { Select, Label } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { CaregiverSearchFilters } from '@/lib/api/types';

export interface AdvancedFilters {
  gender?: string;
  skillIds: string[];
  languageIds: string[];
  locationIds: string[];
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

function toggle(list: string[], id: string): string[] {
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
  const { data: locations, isLoading: locationsLoading } = useLocations();

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
          <div className="flex max-h-52 flex-wrap gap-1.5 overflow-y-auto pr-1">
            {locationsLoading && <span className="text-xs text-ink/40">Loading…</span>}
            {locations?.map((l) => (
              <CheckboxPill
                key={l.id}
                checked={filters.locationIds.includes(l.id)}
                label={`${l.city}`}
                onChange={() => onChange({ ...filters, locationIds: toggle(filters.locationIds, l.id) })}
              />
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
