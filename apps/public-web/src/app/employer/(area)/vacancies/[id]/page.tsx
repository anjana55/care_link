'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useEmployerVacancies, useSaveVacancy } from '@/lib/hooks/use-international';
import { VacancyForm } from '@/components/international/vacancy-form';

/** Change a vacancy that is waiting for review or was sent back. It goes back for review. */
export default function EditVacancyPage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { data = [], isLoading } = useEmployerVacancies();
  const save = useSaveVacancy();
  const vacancy = data.find((v) => v.id === id);
  const editable = vacancy && (vacancy.status === 'PENDING_REVIEW' || vacancy.status === 'REJECTED');

  return (
    <div className="space-y-4">
      <Link href="/employer/vacancies" className="inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink">
        <ChevronLeft className="h-4 w-4" aria-hidden />
        {t('employer.vacancies.title')}
      </Link>
      <h1 className="text-xl font-bold text-ink">{t('employer.vacancies.editTitle')}</h1>
      {isLoading && <div className="h-64 animate-pulse rounded-lg bg-white" aria-hidden />}
      {!isLoading && !vacancy && <p className="text-sm text-ink/60">{t('vacancies.notFound')}</p>}
      {vacancy && !editable && <p className="rounded-lg border border-border bg-white p-4 text-sm text-ink/70">{t('employer.vacancies.notEditable')}</p>}
      {vacancy && editable && (
        <VacancyForm
          vacancy={vacancy}
          pending={save.isPending}
          error={save.error}
          onSubmit={(body) => save.mutate({ id: vacancy.id, body }, { onSuccess: () => router.push('/employer/vacancies') })}
        />
      )}
    </div>
  );
}
