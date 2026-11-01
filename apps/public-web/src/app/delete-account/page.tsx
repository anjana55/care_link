'use client';

import { useState } from 'react';
import Link from 'next/link';
import type { AccountDeletionReceipt } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useAuth } from '@/lib/api/auth-context';
import { api, ApiError } from '@/lib/api/client';
import { rememberReturnTo } from '@/lib/return-to';
import { fmtDate } from '@/lib/colombo-time';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { Button } from '@/components/ui/button';

const PATH = '/delete-account';
/** The Sri Lankan date of an ISO time, for fmtDate. */
const colomboDay = (iso: string) => new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 10);

/**
 * "Delete your account" - the web page Google Play asks for, and the same
 * request the app makes (POST /me/account/deletion). Signed out, it explains
 * and offers to sign in, coming back here; signed in as a client or caregiver,
 * it asks for confirmation and closes the account.
 */
export default function DeleteAccountPage() {
  const { t, locale } = useTranslation();
  const { user, loading, logout } = useAuth();
  const [confirmed, setConfirmed] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [eraseAfter, setEraseAfter] = useState<string | null>(null);

  const canDelete = user?.role === 'CAREGIVER' || user?.role === 'PATIENT_GUARDIAN';

  const submit = async () => {
    setPending(true);
    setError(null);
    try {
      const receipt = await api.post<AccountDeletionReceipt>('/me/account/deletion');
      setEraseAfter(receipt.eraseAfter);
      // The account is locked: this browser's session is over too.
      logout();
    } catch (err) {
      setError(err instanceof ApiError && err.message ? err.message : t('deleteAccount.error'));
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader maxWidth="sm" />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
        <h1 className="text-2xl font-semibold text-ink">{t('deleteAccount.title')}</h1>
        <p className="mt-2 text-ink/70">{t('deleteAccount.intro')}</p>

        <section className="mt-6 rounded-lg border border-border bg-white p-5">
          <h2 className="text-sm font-semibold text-ink">{t('deleteAccount.whatHappens')}</h2>
          <ul className="mt-3 list-disc space-y-2 pl-5 text-sm text-ink/80">
            <li>{t('deleteAccount.steps.closed')}</li>
            <li>{t('deleteAccount.steps.erased')}</li>
            <li>{t('deleteAccount.steps.open')}</li>
            <li>{t('deleteAccount.steps.kept')}</li>
          </ul>
          <p className="mt-4 text-sm text-ink/70">{t('deleteAccount.changeMind')}</p>
        </section>

        <section className="mt-6 rounded-lg border border-border bg-white p-5" aria-live="polite">
          {eraseAfter ? (
            <p role="status" className="text-sm font-medium text-brand-dark">
              {t('deleteAccount.done', { date: fmtDate(colomboDay(eraseAfter), locale) })}
            </p>
          ) : loading ? (
            <p className="text-sm text-ink/60">{t('common.loading')}</p>
          ) : !user ? (
            <>
              <p className="text-sm text-ink/80">{t('deleteAccount.signInToDelete')}</p>
              <div className="mt-4 flex flex-wrap gap-3">
                <Link href="/login" onClick={() => rememberReturnTo(PATH)} className="rounded-md bg-brand px-4 py-2 text-sm font-medium text-white hover:bg-brand-dark">
                  {t('deleteAccount.signInClient')}
                </Link>
                <Link href="/caregiver/login" onClick={() => rememberReturnTo(PATH)} className="rounded-md border border-border px-4 py-2 text-sm font-medium text-ink hover:border-brand">
                  {t('deleteAccount.signInCaregiver')}
                </Link>
              </div>
            </>
          ) : !canDelete ? (
            <p className="text-sm text-ink/80">{t('deleteAccount.notHere')}</p>
          ) : (
            <form
              onSubmit={(e) => {
                e.preventDefault();
                if (confirmed && !pending) void submit();
              }}
            >
              <p className="text-sm text-ink/60">{t('deleteAccount.signedInAs', { name: user.email ?? user.phone ?? '' })}</p>
              <label className="mt-4 flex items-start gap-3 text-sm text-ink">
                <input type="checkbox" className="mt-1" checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} />
                <span>{t('deleteAccount.confirm')}</span>
              </label>
              {error && (
                <p role="alert" className="mt-3 text-sm text-danger">
                  {error}
                </p>
              )}
              <Button type="submit" variant="danger" className="mt-4" disabled={!confirmed || pending}>
                {pending ? t('common.loading') : t('deleteAccount.delete')}
              </Button>
            </form>
          )}
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
