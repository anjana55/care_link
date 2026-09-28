'use client';

import { useState } from 'react';
import { useAuth } from '@/lib/api/auth-context';
import { useCaregiver } from '@/lib/hooks/use-caregivers';
import { useTranslation } from '@/lib/i18n/provider';
import { Card, CardContent } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { StepIndicator } from '@/components/caregivers/step-indicator';
import { QualificationsStep } from '@/components/caregivers/wizard-step-qualifications';
import { ExperienceStep } from '@/components/caregivers/wizard-step-experience';
import { SkillsStep } from '@/components/caregivers/wizard-step-skills';
import { LanguagesStep } from '@/components/caregivers/wizard-step-languages';
import { AvailabilityStep } from '@/components/caregivers/wizard-step-availability';
import { DocumentsStep } from '@/components/caregivers/wizard-step-documents';
import { ReviewStep } from '@/components/caregivers/wizard-step-review';

// Personal info is already collected at registration, so the self-service
// flow picks up from qualifications - same step components the staff
// wizard uses, just always pointed at the caller's own caregiverId.
const STEP_KEYS = ['qualifications', 'experience', 'skills', 'languages', 'availability', 'documents', 'review'] as const;

function CompleteRegistration({ caregiverId }: { caregiverId: string }) {
  const { t } = useTranslation();
  const [stepIndex, setStepIndex] = useState(0);
  const steps = STEP_KEYS.map((key) => t(`caregivers.wizard.steps.${key}`));
  const next = () => setStepIndex((i) => Math.min(i + 1, STEP_KEYS.length - 1));
  const back = () => setStepIndex((i) => Math.max(i - 1, 0));

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[200px_1fr]">
      <div className="hidden lg:block">
        <StepIndicator steps={steps} currentIndex={stepIndex} />
      </div>
      <Card>
        <CardContent className="py-6">
          {stepIndex === 0 && <QualificationsStep caregiverId={caregiverId} onNext={next} onBack={back} />}
          {stepIndex === 1 && <ExperienceStep caregiverId={caregiverId} onNext={next} onBack={back} />}
          {stepIndex === 2 && <SkillsStep caregiverId={caregiverId} onNext={next} onBack={back} />}
          {stepIndex === 3 && <LanguagesStep caregiverId={caregiverId} onNext={next} onBack={back} />}
          {stepIndex === 4 && <AvailabilityStep caregiverId={caregiverId} onNext={next} onBack={back} />}
          {stepIndex === 5 && <DocumentsStep caregiverId={caregiverId} onNext={next} onBack={back} />}
          {stepIndex === 6 && <ReviewStep caregiverId={caregiverId} onBack={back} />}
        </CardContent>
      </Card>
    </div>
  );
}

function SubmittedOverview({ caregiverId }: { caregiverId: string }) {
  const { t } = useTranslation();
  const { data: caregiver } = useCaregiver(caregiverId);

  return (
    <div className="space-y-5">
      <Card>
        <CardContent className="py-5">
          <p className="text-sm text-ink">{t('myProfile.afterSubmitNotice')}</p>
        </CardContent>
      </Card>

      {caregiver && (
        <Card>
          <CardContent className="grid grid-cols-1 gap-4 py-5 sm:grid-cols-2">
            <div>
              <div className="text-xs text-ink/50">{t('myProfile.skills')}</div>
              <div className="text-sm text-ink">{caregiver.skills.map((s) => s.name).join(', ') || '—'}</div>
            </div>
            <div>
              <div className="text-xs text-ink/50">{t('myProfile.languages')}</div>
              <div className="text-sm text-ink">{caregiver.languages.map((l) => l.name).join(', ') || '—'}</div>
            </div>
            <div className="sm:col-span-2">
              <div className="text-xs text-ink/50">{t('myProfile.documentsOnFile')}</div>
              <div className="text-sm text-ink">{caregiver.documents.length}</div>
            </div>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardContent className="py-5">
          <h3 className="mb-4 text-sm font-semibold text-ink">{t('caregivers.wizard.steps.documents')}</h3>
          <DocumentsStep caregiverId={caregiverId} hideNav />
        </CardContent>
      </Card>
    </div>
  );
}

export default function MyRegistrationPage() {
  const { user } = useAuth();
  const { t } = useTranslation();
  const { data: caregiver, isLoading } = useCaregiver(user?.caregiverId);

  if (!user?.caregiverId) return null;

  return (
    <div>
      <div className="mb-6 flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-ink">{t('myProfile.title')}</h1>
          {caregiver && <p className="text-sm text-ink/50">{caregiver.registrationNumber}</p>}
        </div>
        {caregiver && <StatusBadge status={caregiver.status} label={t(`caregivers.status.${caregiver.status}`)} />}
      </div>

      {isLoading || !caregiver ? (
        <p className="text-sm text-ink/50">{t('common.loading')}</p>
      ) : caregiver.status === 'DRAFT' ? (
        <>
          <p className="mb-5 text-sm text-ink/60">{t('myProfile.draftNotice')}</p>
          <CompleteRegistration caregiverId={user.caregiverId} />
        </>
      ) : (
        <SubmittedOverview caregiverId={user.caregiverId} />
      )}
    </div>
  );
}
