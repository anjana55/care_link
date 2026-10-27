'use client';

import { useState } from 'react';
import { Megaphone } from 'lucide-react';
import type { EmployerEnquiry } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useStaffVacancies } from '@/lib/hooks/use-international';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { StaffVacancyForm } from './staff-vacancy-form';
import { VacancyCard } from './vacancies-tab';

/**
 * The vacancies on an enquiry. Staff can post one for an employer who wrote in
 * without an account - it goes straight on the board, and its applicants are
 * put forward onto this enquiry.
 */
export function EnquiryVacanciesCard({ enquiry }: { enquiry: EmployerEnquiry }) {
  const { t } = useTranslation();
  const { data = [] } = useStaffVacancies({ enquiryId: enquiry.id });
  const [posting, setPosting] = useState(false);
  const open = ['NEW', 'IN_PROGRESS', 'INTRODUCED'].includes(enquiry.status);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('international.vacancies.onEnquiry')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.length === 0 && !posting && <p className="text-sm text-ink/50">{t('international.vacancies.noneOnEnquiry')}</p>}
        {data.map((v) => (
          <VacancyCard key={v.id} vacancy={v} compact />
        ))}
        {open &&
          (posting ? (
            <StaffVacancyForm enquiry={enquiry} onDone={() => setPosting(false)} />
          ) : (
            <Button size="sm" variant="secondary" onClick={() => setPosting(true)}>
              <Megaphone size={14} aria-hidden />
              {t('international.vacancies.post')}
            </Button>
          ))}
      </CardContent>
    </Card>
  );
}
