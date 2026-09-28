'use client';

import { useState } from 'react';
import { useTranslation } from '@/lib/i18n/provider';
import { Card, CardContent } from '@/components/ui/card';
import { StepIndicator } from '@/components/caregivers/step-indicator';
import { PersonalInfoStep } from '@/components/caregivers/wizard-step-personal';
import { QualificationsStep } from '@/components/caregivers/wizard-step-qualifications';
import { ExperienceStep } from '@/components/caregivers/wizard-step-experience';
import { SkillsStep } from '@/components/caregivers/wizard-step-skills';
import { LanguagesStep } from '@/components/caregivers/wizard-step-languages';
import { AvailabilityStep } from '@/components/caregivers/wizard-step-availability';
import { DocumentsStep } from '@/components/caregivers/wizard-step-documents';
import { ReviewStep } from '@/components/caregivers/wizard-step-review';

const STEP_KEYS = [
  'personal',
  'qualifications',
  'experience',
  'skills',
  'languages',
  'availability',
  'documents',
  'review',
] as const;

export default function NewCaregiverPage() {
  const { t } = useTranslation();
  const [stepIndex, setStepIndex] = useState(0);
  const [caregiverId, setCaregiverId] = useState<string | null>(null);

  const steps = STEP_KEYS.map((key) => t(`caregivers.wizard.steps.${key}`));
  const next = () => setStepIndex((i) => Math.min(i + 1, STEP_KEYS.length - 1));
  const back = () => setStepIndex((i) => Math.max(i - 1, 0));

  return (
    <div>
      <h1 className="mb-6 text-xl font-semibold text-ink">{t('caregivers.wizard.title')}</h1>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[220px_1fr]">
        <div className="hidden lg:block">
          <StepIndicator steps={steps} currentIndex={stepIndex} />
        </div>

        <Card>
          <CardContent className="py-6">
            {stepIndex === 0 && (
              <PersonalInfoStep
                onCreated={(id) => {
                  setCaregiverId(id);
                  next();
                }}
              />
            )}
            {stepIndex > 0 && !caregiverId && (
              <p className="text-sm text-danger">Something went wrong — please restart the registration.</p>
            )}
            {stepIndex === 1 && caregiverId && <QualificationsStep caregiverId={caregiverId} onNext={next} onBack={back} />}
            {stepIndex === 2 && caregiverId && <ExperienceStep caregiverId={caregiverId} onNext={next} onBack={back} />}
            {stepIndex === 3 && caregiverId && <SkillsStep caregiverId={caregiverId} onNext={next} onBack={back} />}
            {stepIndex === 4 && caregiverId && <LanguagesStep caregiverId={caregiverId} onNext={next} onBack={back} />}
            {stepIndex === 5 && caregiverId && <AvailabilityStep caregiverId={caregiverId} onNext={next} onBack={back} />}
            {stepIndex === 6 && caregiverId && <DocumentsStep caregiverId={caregiverId} onNext={next} onBack={back} />}
            {stepIndex === 7 && caregiverId && <ReviewStep caregiverId={caregiverId} onBack={back} />}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
