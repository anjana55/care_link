'use client';

import { useTranslation } from '@/lib/i18n/provider';
import { Button } from '@/components/ui/button';

/** Footer pager shared by the staff list screens. Hidden when there is one page. */
export function ListPagination({
  page,
  totalPages,
  total,
  noun,
  onPage,
}: {
  page: number;
  totalPages: number;
  total: number;
  /** Plural, lower-case: "caregivers", "clients". */
  noun: string;
  onPage: (page: number) => void;
}) {
  const { t } = useTranslation();
  if (totalPages <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between text-sm text-ink/60">
      <span>{t('common.pageSummary', { page, totalPages, total, noun })}</span>
      <div className="flex gap-2">
        <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)}>
          {t('common.previous')}
        </Button>
        <Button variant="secondary" size="sm" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>
          {t('common.next')}
        </Button>
      </div>
    </div>
  );
}
