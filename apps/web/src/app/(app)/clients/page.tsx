'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Search } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { useClients, useDeleteClient } from '@/lib/hooks/use-clients';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { StatusBadge } from '@/components/ui/badge';
import type { ClientStatus } from '@/lib/api/types';

const STATUSES: ClientStatus[] = ['PENDING_REVIEW', 'ACTIVE', 'INACTIVE', 'SUSPENDED'];

export default function ClientsListPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
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

  const { data, isLoading } = useClients({
    search: search || undefined,
    status: status || undefined,
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
          <option value="">{t('clients.table.status')}</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {t(`clients.status.${s}`)}
            </option>
          ))}
        </Select>
      </div>

      <div className="overflow-hidden rounded-lg border border-border bg-white">
        <table className="w-full text-left text-sm">
          <thead className="border-b border-border bg-paper text-xs uppercase tracking-wide text-ink/50">
            <tr>
              <th className="px-4 py-3 font-medium">{t('clients.table.name')}</th>
              <th className="px-4 py-3 font-medium">{t('clients.table.phone')}</th>
              <th className="px-4 py-3 font-medium">{t('clients.table.email')}</th>
              <th className="px-4 py-3 font-medium">{t('clients.table.status')}</th>
              <th className="px-4 py-3 font-medium">{t('clients.table.account')}</th>
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
                  <Link href={`/clients/${c.id}`} className="font-medium text-brand-dark hover:underline">
                    {c.fullName}
                  </Link>
                </td>
                <td className="px-4 py-3 tabular-nums text-ink/70">{c.phone || '—'}</td>
                <td className="px-4 py-3 text-ink/70">{c.email || '—'}</td>
                <td className="px-4 py-3">
                  <StatusBadge status={c.status} label={t(`clients.status.${c.status}`)} />
                </td>
                <td className="px-4 py-3">
                  <span
                    className={
                      c.isActive
                        ? 'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-brand-light text-brand-dark'
                        : 'inline-flex items-center rounded px-2 py-0.5 text-xs font-medium bg-ink/10 text-ink/60'
                    }
                  >
                    {c.isActive ? t('clients.account.active') : t('clients.account.inactive')}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink/70">{new Date(c.createdAt).toLocaleDateString()}</td>
                {canEdit && (
                  <td className="px-4 py-3">
                    {/* Editing details is a staff operation; deleting the
                        account stays admin-only, matching the API's @Roles. */}
                    <Link
                      href={`/clients/${c.id}?edit=1`}
                      className="text-sm text-brand-dark hover:underline"
                    >
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
    </div>
  );
}