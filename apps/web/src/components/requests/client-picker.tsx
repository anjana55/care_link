'use client';

import { useState } from 'react';
import { Search } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { useClients } from '@/lib/hooks/use-clients';
import { Input } from '@/components/ui/input';
import { StatusBadge } from '@/components/ui/badge';
import type { Client } from '@/lib/api/types';
import { useDebounced } from './caregiver-picker';

/** Find an existing client by name, phone or email - always try this before adding a new caller. */
export function ClientPicker({ onPick }: { onPick: (c: Client) => void }) {
  const { t } = useTranslation();
  const [term, setTerm] = useState('');
  const search = useDebounced(term.trim());
  const { data, isFetching } = useClients({ search: search || undefined, page: 1, pageSize: 6 });

  return (
    <div>
      <div className="relative">
        <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
        <Input
          autoFocus
          className="pl-9"
          placeholder={t('requests.picker.clientSearch')}
          value={term}
          onChange={(e) => setTerm(e.target.value)}
          aria-label={t('requests.picker.clientSearch')}
        />
      </div>
      {search.length > 0 && (
        <ul className="mt-2 divide-y divide-border rounded border border-border" aria-busy={isFetching}>
          {data?.items.length === 0 && <li className="px-3 py-2 text-sm text-ink/50">{t('requests.picker.noClientMatches')}</li>}
          {data?.items.map((c) => (
            <li key={c.id}>
              <button type="button" onClick={() => onPick(c)} className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-paper">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-ink">{c.fullName}</span>
                  <span className="block text-xs text-ink/50">
                    {[c.phone || c.accountPhone, c.email, c.recipientName && t('requests.forRecipient', { name: c.recipientName })].filter(Boolean).join(' · ')}
                  </span>
                </span>
                <StatusBadge status={c.status} label={t(`clients.status.${c.status}`)} />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
