'use client';

import Link from 'next/link';
import type { StaffAccountDeletion } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { fmtDateTime } from '@/lib/colombo-time';

/**
 * On a caregiver's or client's page while they have asked to delete their
 * account: what happened and what to do, rather than just "Inactive".
 */
export function PendingDeletionBanner({ request }: { request: StaffAccountDeletion }) {
  const { t, locale } = useTranslation();
  return (
    <div role="alert" className="mb-6 rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-ink">
      <p className="font-semibold text-danger">{t('accountDeletions.banner.title')}</p>
      <p className="mt-1 text-ink/80">
        {t('accountDeletions.banner.body', { asked: fmtDateTime(request.requestedAt, locale), erase: fmtDateTime(request.eraseAfter, locale) })}
      </p>
      <Link href="/account-deletions" className="mt-2 inline-block font-medium text-brand-dark underline">
        {t('accountDeletions.banner.open')}
      </Link>
    </div>
  );
}
