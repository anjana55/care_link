'use client';

import { useState } from 'react';
import Link from 'next/link';
import { CheckCircle2 } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useEmployerAccount, useSaveVacancy } from '@/lib/hooks/use-international';
import { VacancyForm } from '@/components/international/vacancy-form';

/** Post a vacancy. It goes on the board once our team has checked it. */
export default function NewVacancyPage() {
  const { t } = useTranslation();
  const { data: account } = useEmployerAccount();
  const save = useSaveVacancy();
  const [reference, setReference] = useState<string | null>(null);

  if (reference) {
    return (
      <div role="status" className="rounded-lg border border-brand/30 bg-white p-8 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-brand" aria-hidden />
        <h1 className="mt-3 text-lg font-semibold text-ink">{t('employer.vacancies.sentTitle')}</h1>
        <p className="mx-auto mt-2 max-w-md text-sm text-ink/70">{t('employer.vacancies.sentBody', { reference })}</p>
        <Link href="/employer/vacancies" className="mt-4 inline-block text-sm font-semibold text-brand hover:text-brand-dark">
          {t('employer.vacancies.title')}
        </Link>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-xl font-bold text-ink">{t('employer.vacancies.new')}</h1>
        <p className="mt-1 text-sm text-ink/60">{t('employer.vacancies.newIntro')}</p>
      </div>
      {account && account.status !== 'VERIFIED' ? (
        <p className="rounded-lg border border-border bg-white p-4 text-sm text-ink/70">{t('employer.vacancies.verifyFirst')}</p>
      ) : (
        account && <VacancyForm defaultCountry={account.country} pending={save.isPending} error={save.error} onSubmit={(body) => save.mutate({ body }, { onSuccess: (v) => setReference(v.reference) })} />
      )}
    </div>
  );
}
