'use client';

import { useEffect, useState } from 'react';
import { Search, X } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { useCaregivers } from '@/lib/hooks/use-caregivers';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import type { CaregiverStatus } from '@/lib/api/types';

export interface PickedCaregiver {
  id: string;
  fullName: string;
  registrationNumber: string;
  status: CaregiverStatus;
}

/** Waits for typing to pause before searching, so each keystroke is not a request. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setDebounced(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/**
 * Find a caregiver by name, registration number or phone. Any caregiver whose
 * record has not been removed can be chosen - staff may know someone who is
 * verified but not yet live on the public site - and the status is shown so
 * that choice is a deliberate one.
 */
export function CaregiverPicker({ onPick, onCancel, autoFocus }: { onPick: (c: PickedCaregiver) => void; onCancel?: () => void; autoFocus?: boolean }) {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const { data, isFetching } = useCaregivers({ search: search || undefined, page: 1, pageSize: 6 });

  return (
    <div className="rounded border border-border bg-white p-3">
      <div className="flex items-center gap-2">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
          <Input
            autoFocus={autoFocus}
            className="pl-9"
            placeholder={t('requests.picker.caregiverSearch')}
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            aria-label={t('requests.picker.caregiverSearch')}
          />
        </div>
        {onCancel && (
          <button type="button" onClick={onCancel} aria-label={t('common.cancel')} className="rounded p-2 text-ink/50 hover:bg-paper hover:text-ink">
            <X size={16} />
          </button>
        )}
      </div>
      {search.length > 0 && (
        <ul className="mt-2 divide-y divide-border" aria-busy={isFetching}>
          {data?.items.length === 0 && <li className="py-2 text-sm text-ink/50">{t('requests.picker.noMatches')}</li>}
          {data?.items.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onPick({ id: c.id, fullName: c.fullName, registrationNumber: c.registrationNumber, status: c.status })}
                className="flex w-full items-center justify-between gap-3 rounded px-2 py-2 text-left hover:bg-paper"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{c.fullName}</span>
                  <span className="block text-xs tabular-nums text-ink/50">
                    {c.registrationNumber}
                    {c.locations?.length ? ` · ${c.locations.slice(0, 2).join(', ')}` : ''}
                  </span>
                </span>
                <StatusBadge status={c.status} label={t(`caregivers.status.${c.status}`)} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
