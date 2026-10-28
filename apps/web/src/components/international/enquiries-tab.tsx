'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Plus, Search, UserRound } from 'lucide-react';
import { useAuth } from '@/lib/api/auth-context';
import { NewEnquiryForm } from '@/components/overseas-admin/new-enquiry-form';
import { useTranslation } from '@/lib/i18n/provider';
import { useEmployerEnquiries } from '@/lib/hooks/use-international';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { EnquiryStatusBadge, countryName } from './shared';

const STATUS_FILTERS = ['open', 'NEW', 'IN_PROGRESS', 'INTRODUCED', 'PLACED', 'CLOSED', ''] as const;

/** Overseas employer enquiries: open ones first, newest at the top. */
export function EnquiriesTab() {
  const { t, locale } = useTranslation();
  const [status, setStatus] = useState<string>('open');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const { data, isLoading } = useEmployerEnquiries({ status: status || undefined, search: search.trim() || undefined, page });
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;
  const { user } = useAuth();
  const [adding, setAdding] = useState(false);

  return (
    <div>
      {adding && <NewEnquiryForm onCancel={() => setAdding(false)} />}
      <div className="mb-4 flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink/40" />
          <Input
            placeholder={t('international.enquiries.search')}
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
          aria-label={t('international.enquiries.status')}
          onChange={(e) => {
            setStatus(e.target.value);
            setPage(1);
          }}
        >
          {STATUS_FILTERS.map((s) => (
            <option key={s || 'all'} value={s}>
              {t(`international.enquiries.filters.${s || 'all'}`)}
            </option>
          ))}
        </Select>
        {user?.role === 'ADMIN' && !adding && (
          <Button onClick={() => setAdding(true)}>
            <Plus size={16} aria-hidden />
            {t('overseasAdmin.newEnquiry.button')}
          </Button>
        )}
      </div>

      <div className="overflow-x-auto rounded-lg border border-border bg-white">
        <table className="w-full min-w-[760px] text-left text-sm">
          <thead className="border-b border-border bg-paper text-xs uppercase tracking-wide text-ink/50">
            <tr>
              <th className="px-4 py-3 font-medium">{t('international.enquiries.reference')}</th>
              <th className="px-4 py-3 font-medium">{t('international.enquiries.employer')}</th>
              <th className="px-4 py-3 font-medium">{t('international.enquiries.country')}</th>
              <th className="px-4 py-3 font-medium">{t('international.enquiries.roles')}</th>
              <th className="px-4 py-3 font-medium">{t('international.enquiries.status')}</th>
              <th className="px-4 py-3 font-medium">{t('international.enquiries.received')}</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink/50">
                  {t('common.loading')}
                </td>
              </tr>
            )}
            {!isLoading && data?.items.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-ink/50">
                  {t('international.enquiries.empty')}
                </td>
              </tr>
            )}
            {data?.items.map((e) => (
              <tr key={e.id} className="border-b border-border last:border-0 hover:bg-paper">
                <td className="px-4 py-3">
                  <Link href={`/international/${e.id}`} className="font-medium tabular-nums text-brand-dark hover:underline">
                    {e.reference}
                  </Link>
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-ink">{e.organisationName}</div>
                  <div className="text-xs text-ink/60">
                    {t(`international.employerTypes.${e.organisationType}`)} · {e.contactName}
                  </div>
                  {e.caregiver && (
                    <div className="mt-1 flex items-center gap-1 text-xs text-accent">
                      <UserRound size={12} aria-hidden />
                      {t('international.enquiries.aboutCaregiver', { name: e.caregiver.fullName, number: e.caregiver.registrationNumber })}
                    </div>
                  )}
                </td>
                <td className="px-4 py-3 text-ink/80">{countryName(e.country, locale)}</td>
                <td className="px-4 py-3 tabular-nums text-ink/80">{e.rolesCount}</td>
                <td className="px-4 py-3">
                  <EnquiryStatusBadge status={e.status} />
                </td>
                <td className="px-4 py-3 text-ink/70">{new Date(e.createdAt).toLocaleString()}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {data && totalPages > 1 && (
        <div className="mt-4 flex items-center justify-between text-sm text-ink/60">
          <span>{t('requests.pageOf', { page, totalPages })}</span>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              {t('clients.previous')}
            </Button>
            <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              {t('clients.next')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
