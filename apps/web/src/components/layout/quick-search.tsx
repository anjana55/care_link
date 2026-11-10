'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { CalendarDays, HeartHandshake, Inbox, Loader2, ReceiptText, Search, Users, type LucideIcon } from 'lucide-react';
import { api } from '@/lib/api/client';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { caregiverListPath } from '@/lib/hooks/use-caregivers';
import { clientListPath } from '@/lib/hooks/use-clients';
import { careRequestListPath } from '@/lib/hooks/use-care-requests';
import { bookingListPath } from '@/lib/hooks/use-bookings';
import { invoiceListPath } from '@/lib/hooks/use-billing';
import type { BookingListResponse, CareRequestListResponse, CaregiverListResponse, ClientListResponse, InvoiceListResponse } from '@/lib/api/types';
import { cn } from '@/lib/utils';

/** How many of each kind to show: enough to find a record by name, short enough to read at a glance. */
const PER_KIND = 4;
const MIN_CHARS = 2;

interface Hit {
  href: string;
  title: string;
  detail: string;
}

interface Kind {
  key: 'caregivers' | 'clients' | 'requests' | 'bookings' | 'invoices';
  /** Heading: the same word as the menu item the results belong to. */
  label: string;
  icon: LucideIcon;
  /** Caregivers are open to every staff role; the rest are ADMIN + STAFF, as the API has it. */
  officeOnly: boolean;
  search: (term: string) => Promise<Hit[]>;
}

const join = (...parts: (string | null | undefined)[]) => parts.filter(Boolean).join(' · ');

/**
 * Each kind is searched through its own list's address with a small page -
 * the same search the list pages run, so a term finds here what it finds
 * there, and there is no separate search endpoint to keep in step.
 */
const KINDS: Kind[] = [
  {
    key: 'caregivers',
    label: 'nav.caregivers',
    icon: Users,
    officeOnly: false,
    search: async (search) =>
      (await api.get<CaregiverListResponse>(caregiverListPath({ search, pageSize: PER_KIND }))).items.map((c) => ({
        href: `/caregivers/${c.id}`,
        title: c.fullName,
        detail: join(c.registrationNumber, c.primaryPhone),
      })),
  },
  {
    key: 'clients',
    label: 'nav.clients',
    icon: HeartHandshake,
    officeOnly: true,
    search: async (search) =>
      (await api.get<ClientListResponse>(clientListPath({ search, pageSize: PER_KIND }))).items.map((c) => ({
        href: `/clients/${c.id}`,
        title: c.fullName,
        detail: c.phone ?? '',
      })),
  },
  {
    key: 'requests',
    label: 'nav.requests',
    icon: Inbox,
    officeOnly: true,
    search: async (search) =>
      (await api.get<CareRequestListResponse>(careRequestListPath({ search, pageSize: PER_KIND }))).items.map((r) => ({
        href: `/requests/${r.id}`,
        title: r.reference,
        detail: join(r.clientName, r.recipientName),
      })),
  },
  {
    key: 'bookings',
    label: 'nav.bookings',
    icon: CalendarDays,
    officeOnly: true,
    search: async (search) =>
      (await api.get<BookingListResponse>(bookingListPath({ search, pageSize: PER_KIND }))).items.map((b) => ({
        href: `/bookings/${b.id}`,
        title: b.reference,
        detail: join(b.clientName, b.caregiverName),
      })),
  },
  {
    key: 'invoices',
    label: 'nav.invoices',
    icon: ReceiptText,
    officeOnly: true,
    search: async (search) =>
      (await api.get<InvoiceListResponse>(invoiceListPath({ search, pageSize: PER_KIND }))).items.map((inv) => ({
        href: `/invoices/${inv.id}`,
        title: inv.number ?? inv.clientName,
        detail: inv.number ? inv.clientName : '',
      })),
  },
];

/** One kind failing (a role the API refuses, a network blip) must not empty the others. */
async function searchAll(kinds: Kind[], term: string) {
  const settled = await Promise.allSettled(kinds.map((k) => k.search(term)));
  return kinds.map((kind, i) => ({ kind, hits: settled[i].status === 'fulfilled' ? settled[i].value : [] })).filter((g) => g.hits.length > 0);
}

function useDebounced(value: string, ms: number) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const id = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(id);
  }, [value, ms]);
  return debounced;
}

/**
 * Quick search: one box that finds a caregiver, client, request, booking or
 * invoice from any page, instead of opening the right list first. Opened from
 * the top bar, or with Ctrl+K / Cmd+K.
 */
export function QuickSearch() {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((v) => !v);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={t('quickSearch.open')}
        aria-keyshortcuts="Control+K Meta+K"
        className="flex h-9 shrink-0 items-center gap-2 rounded border border-border px-2.5 text-sm text-ink/60 hover:bg-paper hover:text-ink sm:w-56 sm:px-3"
      >
        <Search size={16} aria-hidden />
        <span className="hidden flex-1 text-left sm:inline">{t('quickSearch.open')}</span>
        <kbd className="hidden rounded border border-border bg-paper px-1.5 text-[11px] font-medium text-ink/50 sm:inline">Ctrl K</kbd>
      </button>
      {open && <QuickSearchDialog onClose={() => setOpen(false)} />}
    </>
  );
}

function QuickSearchDialog({ onClose }: { onClose: () => void }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [text, setText] = useState('');
  const [cursor, setCursor] = useState(0);
  const term = useDebounced(text.trim(), 250);
  const ready = term.length >= MIN_CHARS;

  const office = user?.role === 'ADMIN' || user?.role === 'STAFF';
  const kinds = useMemo(() => KINDS.filter((k) => office || !k.officeOnly), [office]);

  const { data: groups, isFetching } = useQuery({
    queryKey: ['quick-search', office, term],
    queryFn: () => searchAll(kinds, term),
    enabled: ready,
    staleTime: 30_000,
  });

  const shown = ready ? (groups ?? []) : [];
  const flat = shown.flatMap((g) => g.hits);
  const active = Math.min(cursor, Math.max(flat.length - 1, 0));

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  const go = (hit: Hit) => {
    onClose();
    router.push(hit.href);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') onClose();
    else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor(Math.min(active + 1, flat.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor(Math.max(active - 1, 0));
    } else if (e.key === 'Enter' && flat[active]) {
      e.preventDefault();
      go(flat[active]);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[10vh]" role="dialog" aria-modal="true" aria-label={t('quickSearch.open')} onKeyDown={onKeyDown}>
      <button type="button" className="absolute inset-0 bg-black/30" onClick={onClose} aria-label={t('common.cancel')} tabIndex={-1} />
      <div className="relative w-full max-w-xl overflow-hidden rounded-lg border border-border bg-white shadow-xl">
        <div className="flex items-center gap-3 border-b border-border px-4">
          {isFetching ? <Loader2 size={18} className="shrink-0 animate-spin text-brand" aria-hidden /> : <Search size={18} className="shrink-0 text-ink/40" aria-hidden />}
          <input
            ref={inputRef}
            type="search"
            value={text}
            onChange={(e) => {
              setText(e.target.value);
              setCursor(0);
            }}
            placeholder={office ? t('quickSearch.placeholder') : t('quickSearch.placeholderCaregivers')}
            aria-label={t('quickSearch.open')}
            aria-controls="quick-search-results"
            className="h-12 w-full bg-transparent text-sm text-ink outline-none placeholder:text-ink/40"
          />
        </div>

        <div id="quick-search-results" className="max-h-[60vh] overflow-y-auto p-2" aria-live="polite">
          {!ready && <p className="px-3 py-6 text-center text-sm text-ink/50">{t('quickSearch.hint')}</p>}
          {ready && groups && shown.length === 0 && !isFetching && <p className="px-3 py-6 text-center text-sm text-ink/60">{t('quickSearch.none', { term })}</p>}
          {shown.map(({ kind, hits }, g) => {
            const offset = shown.slice(0, g).reduce((n, prev) => n + prev.hits.length, 0);
            return (
            <div key={kind.key} className="mb-1">
              <p className="px-3 pb-1 pt-2 text-xs font-semibold uppercase tracking-wide text-ink/45">{t(kind.label)}</p>
              <ul>
                {hits.map((hit, h) => {
                  const i = offset + h;
                  return (
                    <li key={hit.href}>
                      <button
                        type="button"
                        onClick={() => go(hit)}
                        onMouseEnter={() => setCursor(i)}
                        className={cn('flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm', i === active ? 'bg-brand-light text-brand-dark' : 'text-ink hover:bg-paper')}
                      >
                        <kind.icon size={16} className="shrink-0 text-ink/45" aria-hidden />
                        <span className="min-w-0 flex-1 truncate font-medium">{hit.title}</span>
                        {hit.detail && <span className="max-w-[50%] shrink-0 truncate text-xs text-ink/55">{hit.detail}</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
