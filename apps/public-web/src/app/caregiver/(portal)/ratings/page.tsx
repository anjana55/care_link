'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { MyRatings } from '@/components/reviews/my-ratings';
import { useMarkPathsRead } from '@/lib/hooks/use-notifications';

/** The caregiver's own ratings: average, badges and approved written reviews - never who gave which. */
export default function CaregiverRatingsPage() {
  useMarkPathsRead(['/me/ratings']);
  const { t } = useTranslation();
  return (
    <>
      <Link href="/caregiver/profile" className="mb-3 inline-flex min-h-11 items-center gap-1.5 text-sm font-medium text-ink/60 hover:text-brand">
        <ArrowLeft className="h-4 w-4" aria-hidden />
        {t('portal.nav.profile')}
      </Link>
      <section className="rounded-lg border border-border bg-white p-5" aria-labelledby="ratings-title">
        <h1 id="ratings-title" className="text-base font-semibold text-ink">
          {t('reviews.caregiver.title')}
        </h1>
        <p className="mt-1 text-sm text-ink/60">{t('reviews.caregiver.subtitle')}</p>
        <div className="mt-4">
          <MyRatings />
        </div>
      </section>
    </>
  );
}
