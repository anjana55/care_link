'use client';

import { useEffect, useMemo, useState, type ChangeEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { useClients, useDeleteClient } from '@/lib/hooks/use-clients';
import { useLocationTree } from '@/lib/hooks/use-caregivers';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import { ClientDetailModal } from '@/components/clients/client-detail-modal';
import type { Client, ClientStatus } from '@/lib/api/types';

const STATUSES: ClientStatus[] = ['PENDING_REVIEW', 'ACTIVE', 'INACTIVE', 'SUSPENDED'];
const SCHEDULES = ['DAY', 'NIGHT', 'LIVE_IN_24H', 'NOT_SURE'] as const;
const STARTS = ['IMMEDIATELY', 'WITHIN_WEEK', 'WITHIN_MONTH', 'JUST_EXPLORING'] as const;
const METHODS = ['PHONE_CALL', 'WHATSAPP', 'EMAIL'] as const;

/**
 * Staff view of self-registered patients/guardians. Laid out like the caregiver
 * list.
 *
 * The list row carries the intake the staff list filters by (care schedule,
 * start, place, verification). Clicking through opens the detail modal, which
 * reads from the row - so it inherits the list endpoint's phone masking, and
 * the modal links to those numbers as shown rather than the raw E.164.
 * The full unmasked profile, and the staff edit, live on /clients/[id].
 */
export default function ClientsListPage() {
  const { t, locale } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [districtId, setDistrictId] = useState('');
  const [careSchedule, setCareSchedule] = useState('');
  const [careStart, setCareStart] = useState('');
  const [contactMethod, setContactMethod] = useState('');
  const [verification, setVerification] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Client | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);

  // The API gates this module to ADMIN + STAFF (see @Roles on
  // PatientsController). The shared (app) layout only bounces CAREGIVER, so
  // a VERIFIER can otherwise reach this page and meet a wall of 403s - the
  // same page-local guard /users uses for its own narrower role set.
  useEffect(() => {
    if (authLoading) return;
    if (user && user.role !== 'ADMIN' && user.role !== 'STAFF') {
      router.replace('/dashboard');
    }
  }, [authLoading, user, router]);

  // The location tree is province -> district and comes back with names
  // already resolved for the locale, so the client list flattens it the same
  // way the caregiver advanced filters do.
  const { data: tree } = useLocationTree(locale);
  const districts = useMemo(() => (tree ?? []).flatMap((p) => p.districts), [tree]);

  const { data, isLoading } = useClients({
    search: search || undefined,
    status: status || undefined,
    districtId: districtId ? Number(districtId) : undefined,
    careSchedule: careSchedule || undefined,
    careStart: careStart || undefined,
    contactMethod: contactMethod || undefined,
    verification: (verification || undefined) as 'VERIFIED' | 'UNVERIFIED' | undefined,
    page,
    pageSize: 15,
  });

  const deleteMutation = useDeleteClient();

  const isAdmin = user?.role === 'ADMIN';
  const canEdit = isAdmin || user?.role === 'STAFF';
  const colSpan = canEdit ? 7 : 6;

  // Same guard as users/page.tsx - don't flash the table for a split second
  // before the redirect effect fires.
  if (authLoading || !user || (user.role !== 'ADMIN' && user.role !== 'STAFF')) {
    return (
      <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">
        <span>{t('common.loading')}</span>
      </div>
    );
  }

  /** Any filter change resets to page 1 - staying on page 4 of a newly
   *  narrowed result set would show an empty table that looks like no data. */
  const filter = (setter: (v: string) => void) => (e: ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    setter(e.target.value);
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
            onChange={filter(setSearch)}
          />
        </div>
        <Select
          className="sm:w-56"
          value={status}
          onChange={filter(setStatus)}
        >
          <option value="">{t('clients.table.status')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`clients.status.${s}`)}
            </option>
          ))}
        </Select>
      </div>

      {/* Intake facets. These match nothing on rows registered before the
          intake form existed, so a filtered list legitimately omits them. */}
      <div className="mb-4 flex flex-wrap gap-3">
        <Select value={districtId} onChange={filter(setDistrictId)} aria-label={t('clients.field.district')}>
          <option value="">{t('clients.allDistricts')}</option>
          {districts.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </Select>
        <Select value={careSchedule} onChange={filter(setCareSchedule)} aria-label={t('clients.field.schedule')}>
          <option value="">{t('clients.allSchedules')}</option>
          {SCHEDULES.map((s) => (
            <option key={s} value={s}>
              {t(`clients.options.careSchedule.${s}`)}
            </option>
          ))}
        </Select>
        <Select value={careStart} onChange={filter(setCareStart)} aria-label={t('clients.field.start')}>
          <option value="">{t('clients.allStarts')}</option>
          {STARTS.map((s) => (
            <option key={s} value={s}>
              {t(`clients.options.careStart.${s}`)}
            </option>
          ))}
        </Select>
        <Select value={contactMethod} onChange={filter(setContactMethod)} aria-label={t('clients.field.preferredContact')}>
          <option value="">{t('clients.allContactMethods')}</option>
          {METHODS.map((m) => (
            <option key={m} value={m}>
              {t(`clients.options.contactMethod.${m}`)}
            </option>
          ))}
        </Select>
        <Select value={verification} onChange={filter(setVerification)} aria-label={t('clients.field.verification')}>
          <option value="">{t('clients.allVerification')}</option>
          <option value="VERIFIED">{t('clients.verified')}</option>
          <option value="UNVERIFIED">{t('clients.unverified')}</option>
        </Select>
      </div>

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
              {canEdit && <th className="px-4 py-3 font-medium">{t('clients.table.actions')}</th>}
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
                  <button onClick={() => setSelected(c)} className="text-left font-medium text-brand-dark hover:underline">
                    {c.fullName}
                  </button>
                  {/* A guardian registers under their own name but is arranging
                      care for someone else - show who it is for. */}
                  {c.registrantType === 'GUARDIAN' && c.recipientName && (
                    <div className="text-xs text-ink/50">
                      {t('clients.forRecipient')} {c.recipientName}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3">
                  <div className="tabular-nums text-ink/70">{c.phone || c.accountPhone || c.email || '—'}</div>
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
                    {/* Editing details is a staff operation; deleting the
                        account stays admin-only, matching the API's @Roles. */}
                    <Link href={`/clients/${c.id}?edit=1`} className="text-sm text-brand-dark hover:underline">
                      {t('clients.actions.edit')}
                    </Link>
                    {isAdmin && (
                      <button
                        onClick={() => setDeleteConfirmId(c.id)}
                        className="ml-3 text-sm text-danger hover:underline"
                      >
                        {t('clients.actions.delete')}
                      </button>
                    )}
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {deleteConfirmId && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 p-4">
          <div className="w-full max-w-sm rounded-lg border border-border bg-white p-6">
            <h3 className="mb-2 text-base font-semibold text-ink">{t('clients.deleteTitle')}</h3>
            <p className="mb-4 text-sm text-ink/60">{t('clients.confirmDelete')}</p>
            <div className="flex justify-end gap-2">
              <Button variant="secondary" size="sm" onClick={() => setDeleteConfirmId(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
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
            Page {data.page} of {data.totalPages} · {data.total} {t('clients.title').toLowerCase()}
          </span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              {t('clients.back')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
            </Button>
          </div>
        </div>
      )}

      {selected && <ClientDetailModal client={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}