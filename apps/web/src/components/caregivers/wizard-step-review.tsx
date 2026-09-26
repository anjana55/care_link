'use client';

import { useRouter } from 'next/navigation';
import { CheckCircle2 } from 'lucide-react';
import { useCaregiver, useUpdateCaregiverStatus } from '@/lib/hooks/use-caregivers';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n/provider';

export function ReviewStep({ caregiverId, onBack }: { caregiverId: string; onBack: () => void }) {
  const { t } = useTranslation();
  const router = useRouter();
  const { data: caregiver } = useCaregiver(caregiverId);
  const updateStatus = useUpdateCaregiverStatus(caregiverId);

  if (updateStatus.isSuccess) {
    return (
      <div className="flex flex-col items-center gap-3 py-10 text-center">
        <CheckCircle2 size={40} className="text-brand" />
        <h3 className="text-lg font-semibold text-ink">{t('caregivers.wizard.finishedTitle')}</h3>
        <p className="max-w-sm text-sm text-ink/60">{t('caregivers.wizard.finishedBody')}</p>
        <Button className="mt-2" onClick={() => router.push(`/caregivers/${caregiverId}`)}>
          {t('caregivers.wizard.viewProfile')}
        </Button>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {caregiver && (
        <div className="grid grid-cols-1 gap-4 rounded border border-border p-4 sm:grid-cols-2">
          <div>
            <div className="text-xs text-ink/50">{t('caregivers.me.review.fullName')}</div>
            <div className="text-sm text-ink">{caregiver.fullName}</div>
          </div>
          <div>
            <div className="text-xs text-ink/50">{t('caregivers.me.review.registrationNumber')}</div>
            <div className="text-sm text-ink">{caregiver.registrationNumber}</div>
          </div>
          <div>
            <div className="text-xs text-ink/50">{t('caregivers.me.review.phone')}</div>
            <div className="text-sm text-ink">{caregiver.primaryPhone}</div>
          </div>
          <div>
            <div className="text-xs text-ink/50">{t('caregivers.me.review.skills')}</div>
            <div className="text-sm text-ink">{caregiver.skills.map((s) => s.name).join(', ') || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-ink/50">{t('caregivers.me.review.languages')}</div>
            <div className="text-sm text-ink">{caregiver.languages.map((l) => l.name).join(', ') || '—'}</div>
          </div>
          <div>
            <div className="text-xs text-ink/50">{t('caregivers.me.review.documents')}</div>
            <div className="text-sm text-ink">{caregiver.documents.length} uploaded</div>
          </div>
        </div>
      )}

      <p className="text-sm text-ink/60" dangerouslySetInnerHTML={{ __html: t('caregivers.me.review.submittingNote') }} />

      {updateStatus.isError && <p className="text-sm text-danger">{t('caregivers.me.review.submitError')}</p>}

      <div className="flex justify-between border-t border-border pt-4">
        <Button type="button" variant="secondary" onClick={onBack}>
          {t('caregivers.wizard.back')}
        </Button>
        <Button type="button" onClick={() => updateStatus.mutate('REGISTERED')} disabled={updateStatus.isPending}>
          {updateStatus.isPending ? t('common.loading') : t('caregivers.wizard.finish')}
        </Button>
      </div>
    </div>
  );
}