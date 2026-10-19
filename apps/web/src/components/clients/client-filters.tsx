'use client';

import { SlidersHorizontal, X } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { Label, Select } from '@/components/ui/input';
import { FilterChip } from '@/components/ui/filter-chip';
import type { ClientFilters as ClientApiFilters } from '@/lib/hooks/use-clients';

export const CARE_SCHEDULES = ['DAY', 'NIGHT', 'LIVE_IN_24H', 'NOT_SURE'] as const;
export const CARE_STARTS = ['IMMEDIATELY', 'WITHIN_WEEK', 'WITHIN_MONTH', 'JUST_EXPLORING'] as const;
export const CONTACT_METHODS = ['PHONE_CALL', 'WHATSAPP', 'EMAIL'] as const;

/**
 * The Clients list's intake facets, kept behind a "Filters" button the same
 * way the Caregivers list keeps its advanced filters - search and status stay
 * on the toolbar, everything else opens a panel and shows as removable chips.
 *
 * These match nothing on clients registered before the intake form existed,
 * so a filtered list legitimately omits them.
 */
export interface ClientIntakeFilters {
  districtId: string;
  careSchedule: string;
  careStart: string;
  contactMethod: string;
  verification: '' | 'VERIFIED' | 'UNVERIFIED';
}

export const EMPTY_CLIENT_FILTERS: ClientIntakeFilters = {
  districtId: '',
  careSchedule: '',
  careStart: '',
  contactMethod: '',
  verification: '',
};

export function countClientFilters(f: ClientIntakeFilters): number {
  return Object.values(f).filter(Boolean).length;
}

export function toClientApiFilters(f: ClientIntakeFilters): Partial<ClientApiFilters> {
  return {
    districtId: f.districtId ? Number(f.districtId) : undefined,
    careSchedule: f.careSchedule || undefined,
    careStart: f.careStart || undefined,
    contactMethod: f.contactMethod || undefined,
    verification: f.verification || undefined,
  };
}

export function ClientFiltersPanel({
  filters,
  districts,
  onChange,
  onClose,
}: {
  filters: ClientIntakeFilters;
  districts: { id: number; name: string }[];
  onChange: (next: ClientIntakeFilters) => void;
  onClose: () => void;
}) {
  const { t } = useTranslation();
  const activeCount = countClientFilters(filters);
  const set = (key: keyof ClientIntakeFilters) => (e: React.ChangeEvent<HTMLSelectElement>) =>
    onChange({ ...filters, [key]: e.target.value });

  return (
    <div className="rounded-lg border border-border bg-white p-4">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-semibold text-ink">
          <SlidersHorizontal size={15} />
          {t('filters.advanced')}
          {activeCount > 0 && (
            <span className="rounded-full bg-brand px-1.5 py-0.5 text-[10px] font-semibold text-white">{activeCount}</span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {activeCount > 0 && (
            <button
              type="button"
              onClick={() => onChange(EMPTY_CLIENT_FILTERS)}
              className="text-xs font-medium text-ink/50 hover:text-danger"
            >
              {t('filters.clearAll')}
            </button>
          )}
          <button type="button" onClick={onClose} aria-label={t('clients.detail.close')} className="text-ink/40 hover:text-ink">
            <X size={16} />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 md:grid-cols-2 lg:grid-cols-5">
        <div>
          <Label htmlFor="cf-district">{t('clients.field.district')}</Label>
          <Select id="cf-district" value={filters.districtId} onChange={set('districtId')}>
            <option value="">{t('clients.allDistricts')}</option>
            {districts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="cf-schedule">{t('clients.field.schedule')}</Label>
          <Select id="cf-schedule" value={filters.careSchedule} onChange={set('careSchedule')}>
            <option value="">{t('clients.allSchedules')}</option>
            {CARE_SCHEDULES.map((s) => (
              <option key={s} value={s}>
                {t(`clients.options.careSchedule.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="cf-start">{t('clients.field.start')}</Label>
          <Select id="cf-start" value={filters.careStart} onChange={set('careStart')}>
            <option value="">{t('clients.allStarts')}</option>
            {CARE_STARTS.map((s) => (
              <option key={s} value={s}>
                {t(`clients.options.careStart.${s}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="cf-contact">{t('clients.field.preferredContact')}</Label>
          <Select id="cf-contact" value={filters.contactMethod} onChange={set('contactMethod')}>
            <option value="">{t('clients.allContactMethods')}</option>
            {CONTACT_METHODS.map((m) => (
              <option key={m} value={m}>
                {t(`clients.options.contactMethod.${m}`)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="cf-verification">{t('clients.field.verification')}</Label>
          <Select id="cf-verification" value={filters.verification} onChange={set('verification')}>
            <option value="">{t('clients.allVerification')}</option>
            <option value="VERIFIED">{t('clients.verified')}</option>
            <option value="UNVERIFIED">{t('clients.unverified')}</option>
          </Select>
        </div>
      </div>
    </div>
  );
}

/** The chips row above the table - one per active facet, plus "Clear all". */
export function ClientFilterChips({
  filters,
  districts,
  onChange,
}: {
  filters: ClientIntakeFilters;
  districts: { id: number; name: string }[];
  onChange: (next: ClientIntakeFilters) => void;
}) {
  const { t } = useTranslation();
  if (countClientFilters(filters) === 0) return null;
  const clear = (key: keyof ClientIntakeFilters) => () => onChange({ ...filters, [key]: '' });
  const districtName = districts.find((d) => String(d.id) === filters.districtId)?.name ?? filters.districtId;

  return (
    <div className="mb-4 flex flex-wrap items-center gap-2">
      {filters.districtId && <FilterChip label={districtName} onRemove={clear('districtId')} />}
      {filters.careSchedule && (
        <FilterChip label={t(`clients.options.careSchedule.${filters.careSchedule}`)} onRemove={clear('careSchedule')} />
      )}
      {filters.careStart && (
        <FilterChip label={t(`clients.options.careStart.${filters.careStart}`)} onRemove={clear('careStart')} />
      )}
      {filters.contactMethod && (
        <FilterChip label={t(`clients.options.contactMethod.${filters.contactMethod}`)} onRemove={clear('contactMethod')} />
      )}
      {filters.verification && (
        <FilterChip
          label={filters.verification === 'VERIFIED' ? t('clients.verified') : t('clients.unverified')}
          onRemove={clear('verification')}
        />
      )}
      <button
        type="button"
        onClick={() => onChange(EMPTY_CLIENT_FILTERS)}
        className="text-xs font-medium text-ink/40 hover:text-danger"
      >
        {t('filters.clearAll')}
      </button>
    </div>
  );
}
