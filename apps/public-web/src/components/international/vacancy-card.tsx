'use client';

import Link from 'next/link';
import { BedDouble, Briefcase, CalendarClock, Clock, Languages, MapPin, Wallet } from 'lucide-react';
import type { PublicVacancy } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useCountryNames } from '@/lib/countries';
import { fmtDate } from '@/lib/colombo-time';

/** "USD 1,800 – 2,200 a month", in the reader's number format. Null when no salary was given. */
export function useSalaryText() {
  const { t, locale } = useTranslation();
  return (v: Pick<PublicVacancy, 'salaryMin' | 'salaryMax' | 'salaryCurrency' | 'salaryPeriod'>): string | null => {
    if (v.salaryMin == null && v.salaryMax == null) return null;
    const fmt = (n: number) => {
      try {
        return new Intl.NumberFormat(locale, { style: 'currency', currency: v.salaryCurrency ?? 'USD', maximumFractionDigits: 0 }).format(n);
      } catch {
        return `${v.salaryCurrency ?? ''} ${n}`;
      }
    };
    const amount = v.salaryMin != null && v.salaryMax != null && v.salaryMax !== v.salaryMin ? `${fmt(v.salaryMin)} – ${fmt(v.salaryMax)}` : fmt((v.salaryMin ?? v.salaryMax)!);
    return v.salaryPeriod ? t(`vacancies.per.${v.salaryPeriod}`, { amount }) : amount;
  };
}

/** Where, what kind of employer, and the terms - as short facts with icons. */
export function VacancyFacts({ vacancy: v, full = false }: { vacancy: PublicVacancy; full?: boolean }) {
  const { t } = useTranslation();
  const countries = useCountryNames();
  const salary = useSalaryText()(v);
  const facts: { icon: typeof MapPin; text: string }[] = [
    { icon: MapPin, text: [v.city, countries.name(v.country)].filter(Boolean).join(', ') },
    { icon: Briefcase, text: `${t(`international.employerTypes.${v.organisationType}`)} · ${t(`careTypes.${v.careSetting}`)}` },
  ];
  if (salary) facts.push({ icon: Wallet, text: salary });
  if (v.contractMonths) facts.push({ icon: Clock, text: t('vacancies.contract', { months: v.contractMonths }) });
  if (full) {
    facts.push({ icon: Languages, text: t(`vacancies.english.${v.englishLevel}`) });
    if (v.accommodationProvided) facts.push({ icon: BedDouble, text: t('vacancies.accommodation') });
    if (v.startTimeframe) facts.push({ icon: CalendarClock, text: t('vacancies.start', { when: v.startTimeframe }) });
  }
  return (
    <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm text-ink/70">
      {facts.map(({ icon: Icon, text }) => (
        <li key={text} className="flex items-center gap-1.5">
          <Icon className="h-4 w-4 shrink-0 text-accent" aria-hidden />
          {text}
        </li>
      ))}
    </ul>
  );
}

export function VacancyCard({ vacancy: v }: { vacancy: PublicVacancy }) {
  const { t, locale } = useTranslation();
  return (
    <article className="flex flex-col rounded-lg border border-border bg-white p-5 transition-shadow hover:shadow-md">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h3 className="text-base font-semibold text-ink">
          <Link href={`/work-abroad/vacancies/${v.reference}`} className="hover:text-brand-dark hover:underline">
            {v.title}
          </Link>
        </h3>
        <span className="rounded-full bg-accent-light px-2.5 py-0.5 text-xs font-semibold text-accent-dark">{t('vacancies.roles', { count: v.rolesCount })}</span>
      </div>
      <div className="mt-3">
        <VacancyFacts vacancy={v} />
      </div>
      <p className="mt-3 line-clamp-2 text-sm text-ink/60">{v.description}</p>
      <div className="mt-auto flex items-center justify-between gap-3 pt-4 text-xs text-ink/50">
        <span>{v.closesOn ? t('vacancies.closes', { date: fmtDate(v.closesOn, locale) }) : t('vacancies.posted', { date: fmtDate(v.publishedAt.slice(0, 10), locale) })}</span>
        <Link href={`/work-abroad/vacancies/${v.reference}`} className="text-sm font-semibold text-brand hover:text-brand-dark">
          {t('vacancies.view')}
          <span className="sr-only">: {v.title}</span>
        </Link>
      </div>
    </article>
  );
}
