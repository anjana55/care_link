'use client';

import type { ReadinessReport } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';

/** "5/7" with a short bar; the items are listed in the title for a quick hover. */
export function ReadinessBar({ report }: { report: ReadinessReport }) {
  const { t } = useTranslation();
  const missing = report.items.filter((i) => !i.done).map((i) => t(`international.readiness.${i.key}`));
  return (
    <div className="flex items-center gap-2" title={missing.length ? `${t('international.readiness.missing')}: ${missing.join(', ')}` : t('international.readiness.complete')}>
      <div className="h-1.5 w-16 overflow-hidden rounded-full bg-paper">
        <div className="h-full rounded-full bg-brand" style={{ width: `${(report.done / report.total) * 100}%` }} />
      </div>
      <span className="text-xs tabular-nums text-ink/70">
        {report.done}/{report.total}
      </span>
    </div>
  );
}
