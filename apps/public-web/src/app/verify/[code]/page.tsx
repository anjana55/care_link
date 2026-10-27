'use client';

import { useParams } from 'next/navigation';
import { BadgeCheck, ShieldAlert, ShieldX } from 'lucide-react';
import { CERTIFICATE_CODE_PATTERN } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { fmtDate } from '@/lib/colombo-time';
import { ApiError } from '@/lib/api/client';
import { useCertificateCheck } from '@/lib/hooks/use-international';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';

/**
 * Anyone holding one of our certificates of completion can check it here:
 * whether the number is genuine and still stands, and the first name it was
 * issued to. Nothing more - enough to match the paper, not to find anyone.
 */
export default function VerifyCertificatePage() {
  const { t, locale } = useTranslation();
  const { code } = useParams<{ code: string }>();
  const wellFormed = CERTIFICATE_CODE_PATTERN.test((code ?? '').toUpperCase());
  const { data, isLoading, error } = useCertificateCheck(wellFormed ? code : null);
  const notFound = !wellFormed || (error instanceof ApiError && (error.status === 404 || error.status === 400));

  return (
    <div className="flex min-h-screen flex-col bg-paper">
      <SiteHeader />
      <main className="mx-auto w-full max-w-xl flex-1 px-4 py-10">
        <h1 className="text-2xl font-bold text-ink">{t('verify.title')}</h1>
        <p className="mt-1 text-sm text-ink/60">{t('verify.intro')}</p>

        <div className="mt-6 rounded-lg border border-border bg-white p-6" aria-live="polite">
          {isLoading && wellFormed && <div className="h-24 animate-pulse rounded bg-paper" aria-hidden />}
          {notFound && (
            <div className="flex items-start gap-3">
              <ShieldX className="h-8 w-8 shrink-0 text-danger" aria-hidden />
              <div>
                <p className="font-semibold text-ink">{t('verify.notFound')}</p>
                <p className="mt-1 text-sm text-ink/60">{t('verify.notFoundHelp')}</p>
              </div>
            </div>
          )}
          {error && !notFound && <p className="text-sm text-danger">{t('verify.error')}</p>}
          {data && (
            <div>
              <div className="flex items-start gap-3">
                {data.status === 'VALID' ? <BadgeCheck className="h-8 w-8 shrink-0 text-brand" aria-hidden /> : <ShieldAlert className="h-8 w-8 shrink-0 text-amber-600" aria-hidden />}
                <div>
                  <p className="font-semibold text-ink">{data.status === 'VALID' ? t('verify.valid') : t('verify.revoked')}</p>
                  <p className="mt-1 text-sm text-ink/60">{data.status === 'VALID' ? t('verify.validHelp') : t('verify.revokedHelp')}</p>
                </div>
              </div>
              <dl className="mt-5 divide-y divide-border rounded border border-border text-sm">
                {[
                  [t('verify.number'), data.number],
                  [t('verify.firstName'), data.firstName],
                  [t('verify.programme'), data.programmeTitle],
                  [t('verify.issued'), fmtDate(data.issuedOn, locale)],
                ].map(([label, value]) => (
                  <div key={label} className="grid grid-cols-[minmax(0,2fr)_minmax(0,3fr)] gap-3 px-3 py-2">
                    <dt className="text-ink/60">{label}</dt>
                    <dd className="font-medium text-ink">{value}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-xs text-ink/50">{t('verify.note')}</p>
            </div>
          )}
        </div>
      </main>
      <SiteFooter />
    </div>
  );
}
