'use client';

import { useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { ApiError } from '@/lib/api/client';
import { useCatalog, useToggleAssignment } from '@/lib/hooks/use-caregiver-portal';

/**
 * Tick the skills / languages that apply. Each tick is saved straight away
 * (there is no form to forget to submit), and the list shows what the server
 * now holds rather than what was clicked, so a failed save un-ticks itself.
 */
export function CatalogPicker({ kind, selectedIds }: { kind: 'skills' | 'languages'; selectedIds: string[] }) {
  const { t } = useTranslation();
  const { data: catalog, isLoading, isError } = useCatalog(kind);
  const toggle = useToggleAssignment(kind);
  const [error, setError] = useState<string | null>(null);
  const selected = new Set(selectedIds);

  const onToggle = (itemId: string) => {
    setError(null);
    toggle.mutate(
      { itemId, assigned: selected.has(itemId) },
      { onError: (err) => setError(err instanceof ApiError ? err.message : t('portal.saveError')) },
    );
  };

  return (
    <fieldset>
      <legend className="mb-2 text-sm font-semibold text-ink">{t(`portal.profile.${kind}`)}</legend>
      <p className="mb-3 text-xs text-ink/60">{t(`portal.profile.${kind}Hint`)}</p>
      {isLoading && <p className="text-sm text-ink/60">{t('common.loading')}</p>}
      {isError && <p role="alert" className="text-sm text-danger">{t('portal.loadError')}</p>}
      <div className="flex flex-wrap gap-2">
        {catalog?.map((item) => {
          const on = selected.has(item.id);
          return (
            <label
              key={item.id}
              className={`flex cursor-pointer items-center gap-2 rounded-full border px-3 py-1.5 text-sm transition-colors ${
                on ? 'border-brand bg-brand-light text-brand-dark' : 'border-border text-ink/70 hover:border-brand'
              }`}
            >
              <input type="checkbox" className="sr-only" checked={on} disabled={toggle.isPending} onChange={() => onToggle(item.id)} />
              {item.name}
            </label>
          );
        })}
      </div>
      {error && <p role="alert" className="mt-3 text-sm text-danger">{error}</p>}
    </fieldset>
  );
}
