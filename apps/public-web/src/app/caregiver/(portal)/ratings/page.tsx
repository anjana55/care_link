'use client';

import { useTranslation } from '@/lib/i18n';
import { MyRatings } from '@/components/reviews/my-ratings';

/** The caregiver's own ratings: average, badges and approved written reviews - never who gave which. */
export default function CaregiverRatingsPage() {
  const { t } = useTranslation();
  return (
    <section className="rounded-lg border border-border bg-white p-5" aria-labelledby="ratings-title">
      <h1 id="ratings-title" className="text-base font-semibold text-ink">
        {t('reviews.caregiver.title')}
      </h1>
      <p className="mt-1 text-sm text-ink/60">{t('reviews.caregiver.subtitle')}</p>
      <div className="mt-4">
        <MyRatings />
      </div>
    </section>
  );
}
