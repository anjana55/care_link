'use client';

import { useMemo } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useCities, useLocationTree } from '@/lib/hooks/use-public-search';
import { colomboToday, intakeDefaultsFromSearch, type SearchContext } from '@/lib/care-intent';

/** "Dehiwala, Colombo" for a district/city id pair, in the visitor's language. */
export function useLocationLabel(districtId?: number | null, cityId?: number | null) {
  const { locale } = useTranslation();
  const { data: tree } = useLocationTree(locale);
  const { data: cities } = useCities(districtId ? Number(districtId) : null, locale);
  return useMemo(() => {
    if (!districtId) return undefined;
    const district = (tree ?? []).flatMap((p) => p.districts).find((d) => d.id === Number(districtId))?.name;
    const city = cityId ? (cities ?? []).find((c) => c.id === Number(cityId))?.name : undefined;
    return [city, district].filter(Boolean).join(', ') || undefined;
  }, [tree, cities, districtId, cityId]);
}

/**
 * The search, read back as the few facts a sign-up will reuse - so the visitor
 * can see, before they commit, that they will not be asked these again.
 */
export function useSearchSummaryLines(context: SearchContext | null): string[] {
  const { t } = useTranslation();
  const defaults = useMemo(() => (context ? intakeDefaultsFromSearch(context, t, colomboToday()) : {}), [context, t]);
  const location = useLocationLabel(defaults.districtId, defaults.cityId);
  if (!context) return [];

  const lines: string[] = [];
  if (location) lines.push(location);
  const who = [
    defaults.recipientAge !== undefined ? t('careIntent.summary.age', { age: defaults.recipientAge }) : null,
    defaults.recipientGender ? t(`patientIntake.options.gender.${defaults.recipientGender}`) : null,
  ].filter(Boolean);
  if (who.length > 0) lines.push(who.join(' · '));
  if (defaults.careSchedule) lines.push(t(`patientIntake.options.careSchedule.${defaults.careSchedule}`));
  if (defaults.careStart) lines.push(t(`patientIntake.options.careStart.${defaults.careStart}`));
  if (context.skillNames && context.skillNames.length > 0) lines.push(t('careIntent.needs.help', { list: context.skillNames.join(', ') }));
  return lines;
}

export function CareNeedSummary({ title, lines, action }: { title: string; lines: string[]; action?: React.ReactNode }) {
  if (lines.length === 0) return null;
  return (
    <div className="rounded-DEFAULT border border-brand-light bg-brand-light/40 p-4">
      <div className="flex items-start justify-between gap-3">
        <p className="text-xs font-semibold uppercase tracking-wide text-brand-dark">{title}</p>
        {action}
      </div>
      <ul className="mt-2 space-y-1">
        {lines.map((line, i) => (
          <li key={i} className="flex items-start gap-2 text-sm text-ink/80">
            <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-brand" aria-hidden />
            <span className="whitespace-pre-line break-words">{line}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}
