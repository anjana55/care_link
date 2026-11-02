'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { openItemCount, type AccountOpenItems, type StaffAccountDeletion } from '@care-platform/shared';
import { useAuth } from '@/lib/api/auth-context';
import { ApiError } from '@/lib/api/client';
import { useTranslation } from '@/lib/i18n/provider';
import { fmtDateTime } from '@/lib/colombo-time';
import { useAccountDeletions, useCancelAccountDeletion } from '@/lib/hooks/use-account-deletions';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

const OPEN_KEYS: (keyof AccountOpenItems)[] = [
  'upcomingShifts',
  'unpaidPayouts',
  'activePlacements',
  'activeBookings',
  'unpaidInvoices',
  'openCareRequests',
  'openAdjustments',
];

/**
 * Account deletions (ADMIN + STAFF): people who asked to delete their account
 * in the app or on the website. Each is locked at once and erased 14 days
 * later, once nothing is open - shifts, payouts, bookings, invoices, care
 * requests. Staff settle what's open where they always do, and can cancel a
 * request before it's erased, which restores the account.
 */
export default function AccountDeletionsPage() {
  const { t, locale } = useTranslation();
  const { user } = useAuth();
  const router = useRouter();
  const allowed = user?.role === 'ADMIN' || user?.role === 'STAFF';
  const { data, isLoading, isError } = useAccountDeletions();
  const cancel = useCancelAccountDeletion();
  const [confirming, setConfirming] = useState<StaffAccountDeletion | null>(null);

  useEffect(() => {
    if (user && !allowed) router.replace('/dashboard');
  }, [user, allowed, router]);
  if (!allowed) return null;

  const now = Date.now();
  const nameOf = (r: StaffAccountDeletion) => r.name ?? t('accountDeletions.erasedName');
  const recordHref = (r: StaffAccountDeletion) =>
    r.status === 'ERASED' || r.recordDeleted ? null : r.caregiverId ? `/caregivers/${r.caregiverId}` : r.patientId ? `/clients/${r.patientId}` : null;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">{t('accountDeletions.title')}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink/60">{t('accountDeletions.subtitle')}</p>
      </div>

      <Card>
        <CardContent className="p-0">
          {isLoading && <p className="p-5 text-sm text-ink/60">{t('common.loading')}</p>}
          {isError && <p role="alert" className="p-5 text-sm text-danger">{t('common.actionFailed')}</p>}
          {data && data.length === 0 && <p className="p-5 text-sm text-ink/60">{t('accountDeletions.empty')}</p>}
          {data && data.length > 0 && (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="border-b border-border text-left text-xs uppercase tracking-wide text-ink/50">
                  <tr>
                    <th className="px-4 py-3">{t('accountDeletions.columns.who')}</th>
                    <th className="px-4 py-3">{t('accountDeletions.columns.asked')}</th>
                    <th className="px-4 py-3">{t('accountDeletions.columns.eraseOn')}</th>
                    <th className="px-4 py-3">{t('accountDeletions.columns.open')}</th>
                    <th className="px-4 py-3">{t('accountDeletions.columns.status')}</th>
                    <th className="px-4 py-3">
                      <span className="sr-only">{t('common.actions')}</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {data.map((r) => {
                    const href = recordHref(r);
                    const open = r.openItems ? OPEN_KEYS.filter((k) => r.openItems![k] > 0) : [];
                    const held = r.status === 'PENDING' && openItemCount(r.openItems) > 0 && new Date(r.eraseAfter).getTime() <= now;
                    return (
                      <tr key={r.id} className="align-top">
                        <td className="px-4 py-3">
                          {href ? (
                            <Link href={href} className="font-medium text-brand-dark hover:underline">
                              {nameOf(r)}
                            </Link>
                          ) : (
                            <span className="font-medium text-ink/60">{nameOf(r)}</span>
                          )}
                          <div className="text-xs text-ink/50">
                            {t(`accountDeletions.role.${r.role}`)}
                            {r.reference ? ` · ${r.reference}` : ''}
                          </div>
                          {r.recordDeleted && <div className="text-xs text-ink/50">{t('accountDeletions.recordDeleted')}</div>}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink/70">{fmtDateTime(r.requestedAt, locale)}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-ink/70">{r.status === 'PENDING' ? fmtDateTime(r.eraseAfter, locale) : '—'}</td>
                        <td className="px-4 py-3">
                          {r.status !== 'PENDING' ? (
                            '—'
                          ) : open.length ? (
                            <ul className="space-y-0.5 text-danger">
                              {open.map((k) => (
                                <li key={k}>{t(`accountDeletions.open.${k}`, { n: r.openItems![k] })}</li>
                              ))}
                            </ul>
                          ) : (
                            <span className="text-ink/60">{t('accountDeletions.nothingOpen')}</span>
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <span className={r.status === 'PENDING' ? 'font-medium text-ink' : 'text-ink/60'}>
                            {held ? t('accountDeletions.held') : t(`accountDeletions.status.${r.status}`)}
                          </span>
                          {r.status === 'ERASED' && r.erasedAt ? <div className="text-xs text-ink/50">{fmtDateTime(r.erasedAt, locale)}</div> : null}
                          {r.status === 'CANCELLED' && r.cancelledAt ? <div className="text-xs text-ink/50">{fmtDateTime(r.cancelledAt, locale)}</div> : null}
                        </td>
                        <td className="px-4 py-3 text-right">
                          {r.status === 'PENDING' && !r.recordDeleted && (
                            <Button variant="secondary" size="sm" onClick={() => setConfirming(r)}>
                              {t('accountDeletions.cancel')}
                            </Button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>
      </Card>

      {confirming && (
        <ConfirmDialog
          title={t('accountDeletions.cancelTitle')}
          message={t('accountDeletions.cancelMessage', { name: nameOf(confirming) })}
          confirmLabel={t('accountDeletions.cancel')}
          pending={cancel.isPending}
          error={cancel.error ? (cancel.error instanceof ApiError && cancel.error.message ? cancel.error.message : t('common.actionFailed')) : null}
          onConfirm={() => cancel.mutate(confirming.id, { onSuccess: () => setConfirming(null) })}
          onCancel={() => {
            cancel.reset();
            setConfirming(null);
          }}
        />
      )}
    </div>
  );
}
