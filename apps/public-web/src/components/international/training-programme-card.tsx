'use client';

import { CalendarDays, Clock, MonitorSmartphone } from 'lucide-react';
import type { PublicTrainingProgramme } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';

/** One training programme - on the public Work abroad page and in the caregiver's own section. */
export function TrainingProgrammeCard({ programme, children }: { programme: PublicTrainingProgramme; children?: React.ReactNode }) {
  const { t, locale } = useTranslation();
  const fee =
    programme.feeLkr === null || programme.feeLkr === 0
      ? t('workAbroad.training.free')
      : t('workAbroad.training.fee', { amount: new Intl.NumberFormat(locale, { maximumFractionDigits: 0 }).format(programme.feeLkr) });
  const start = programme.nextStartDate
    ? new Intl.DateTimeFormat(locale, { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(`${programme.nextStartDate}T00:00:00`))
    : null;

  return (
    <div className="flex flex-col rounded-lg border border-border bg-white p-5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="rounded-full bg-accent-light px-2.5 py-0.5 text-xs font-semibold text-accent-dark">{t(`workAbroad.categories.${programme.category}`)}</span>
        <span className="rounded-full bg-paper px-2.5 py-0.5 text-xs font-semibold text-ink/70">{fee}</span>
      </div>
      <h3 className="mt-3 text-base font-semibold text-ink">{programme.title}</h3>
      <p className="mt-1 flex-1 whitespace-pre-line text-sm text-ink/70">{programme.description}</p>
      <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-ink/60">
        <li className="flex items-center gap-1">
          <MonitorSmartphone className="h-3.5 w-3.5" aria-hidden />
          {t(`workAbroad.formats.${programme.format}`)}
        </li>
        {programme.duration && (
          <li className="flex items-center gap-1">
            <Clock className="h-3.5 w-3.5" aria-hidden />
            {programme.duration}
          </li>
        )}
        {start && (
          <li className="flex items-center gap-1">
            <CalendarDays className="h-3.5 w-3.5" aria-hidden />
            {t('workAbroad.training.starts', { date: start })}
          </li>
        )}
      </ul>
      {children && <div className="mt-4 border-t border-border pt-4">{children}</div>}
    </div>
  );
}
