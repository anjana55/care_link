'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { TrainingProgrammes } from '@/components/training/training-programmes';

/**
 * Training: the platform's own programmes (English, caregiving and others),
 * who signed up, their progress and scores, and certificates of completion.
 * Its own menu since it serves every caregiver, not only those going abroad.
 * ADMIN and STAFF; deleting is admins only.
 */
export default function TrainingPage() {
  const { t } = useTranslation();
  const { user, loading } = useAuth();
  const router = useRouter();
  const allowed = user?.role === 'ADMIN' || user?.role === 'STAFF';

  useEffect(() => {
    if (!loading && user && !allowed) router.replace('/dashboard');
  }, [loading, user, allowed, router]);

  if (loading || !allowed) return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;

  return (
    <div>
      <h1 className="mb-4 text-xl font-semibold text-ink">{t('training.title')}</h1>
      <TrainingProgrammes />
    </div>
  );
}
