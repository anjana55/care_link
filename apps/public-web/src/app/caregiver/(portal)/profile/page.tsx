'use client';

import Link from 'next/link';
import { ChevronRight, Star } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { PersonalDetailsForm } from '@/components/portal/personal-details-form';
import { CatalogPicker } from '@/components/portal/catalog-picker';
import { RatesSection } from '@/components/portal/rates-section';
import { RecordSection, type FieldSpec } from '@/components/portal/record-section';
import { useExperiences, useOwnCaregiver, useQualifications } from '@/lib/hooks/use-caregiver-portal';
import { QUALIFICATION_TYPES, type Experience, type Qualification } from '@/lib/api/portal-types';

const QUALIFICATION_FIELDS: FieldSpec[] = [
  { name: 'name', type: 'text', required: true },
  { name: 'type', type: 'select', required: true, options: QUALIFICATION_TYPES, optionLabelPrefix: 'portal.qualifications.types' },
  { name: 'institution', type: 'text', required: true },
  { name: 'certificateNumber', type: 'text' },
  { name: 'issueDate', type: 'date' },
  { name: 'expiryDate', type: 'date' },
];

const EXPERIENCE_FIELDS: FieldSpec[] = [
  { name: 'employerOrClient', type: 'text', required: true },
  { name: 'role', type: 'text', required: true },
  { name: 'country', type: 'text', required: true },
  { name: 'location', type: 'text' },
  { name: 'startDate', type: 'date', required: true },
  { name: 'endDate', type: 'date' },
  { name: 'description', type: 'textarea' },
];

/**
 * Everything staff and families see about the caregiver, in one place: personal
 * details, skills and languages, qualifications and work history.
 */
export default function CaregiverProfilePage() {
  const { t } = useTranslation();
  const { data: caregiver, isLoading, isError } = useOwnCaregiver();
  const qualifications = useQualifications();
  const experiences = useExperiences();

  if (isLoading) return <p className="text-sm text-ink/60">{t('common.loading')}</p>;
  if (isError || !caregiver) return <p role="alert" className="text-sm text-danger">{t('portal.loadError')}</p>;

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">{t('portal.profile.title')}</h1>
        <p className="mt-1 text-sm text-ink/60">{t('portal.profile.subtitle')}</p>
      </div>

      {/* Ratings have no tab of their own: what clients say about this profile opens from it. */}
      <Link href="/caregiver/ratings" className="flex items-center gap-3 rounded-lg border border-border bg-white p-4 transition-colors hover:border-brand/40 hover:bg-brand-light/40">
        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand-dark">
          <Star className="h-5 w-5" aria-hidden />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold text-ink">{t('reviews.caregiver.title')}</span>
          <span className="block text-sm text-ink/60">{t('reviews.caregiver.subtitle')}</span>
        </span>
        <ChevronRight className="h-5 w-5 shrink-0 text-ink/40" aria-hidden />
      </Link>

      {/* Keyed on the saved record so the form re-reads what the server now holds. */}
      <PersonalDetailsForm key={`${caregiver.id}-${caregiver.status}`} caregiver={caregiver} />

      <section className="space-y-6 rounded-lg border border-border bg-white p-5">
        <CatalogPicker kind="skills" selectedIds={caregiver.skills.map((s) => s.skillId)} />
        <CatalogPicker kind="languages" selectedIds={caregiver.languages.map((l) => l.languageId)} />
      </section>

      <RatesSection />

      <RecordSection
        i18n="portal.qualifications"
        rows={qualifications.list.data as never}
        loading={qualifications.list.isLoading}
        fields={QUALIFICATION_FIELDS}
        titleOf={(r) => String(r.name)}
        detailOf={(r) => [r.institution, t(`portal.qualifications.types.${String(r.type)}`)].filter(Boolean).join(' · ')}
        onSave={(values, id) => qualifications.save.mutateAsync({ recordId: id, values })}
        onRemove={(id) => qualifications.remove.mutateAsync(id)}
        saving={qualifications.save.isPending}
      />

      <RecordSection
        i18n="portal.experience"
        rows={experiences.list.data as never}
        loading={experiences.list.isLoading}
        fields={EXPERIENCE_FIELDS}
        titleOf={(r) => `${String(r.role)} — ${String(r.employerOrClient)}`}
        detailOf={(r) => [r.country, `${String(r.startDate).slice(0, 10)} → ${r.endDate ? String(r.endDate).slice(0, 10) : t('portal.experience.present')}`].filter(Boolean).join(' · ')}
        onSave={(values, id) => experiences.save.mutateAsync({ recordId: id, values })}
        onRemove={(id) => experiences.remove.mutateAsync(id)}
        saving={experiences.save.isPending}
      />
    </div>
  );
}
