'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { STAFF_REVIEW_FILTERS, type StaffReviewFilter } from '@care-platform/shared';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { useInitialParam } from '@/lib/use-initial-param';
import { useStaffReviews } from '@/lib/hooks/use-reviews';
import { Input } from '@/components/ui/input';
import { ListPagination } from '@/components/ui/list-pagination';
import { StaffReviewCard } from '@/components/reviews/review-card';
import { cn } from '@/lib/utils';

/**
 * Reviews (ADMIN + STAFF): written reviews waiting for approval, low ratings
 * to follow up with a call, hidden ratings, and everything. Stars and badges
 * count as soon as a client gives them; only the written part waits here.
 */
export default function ReviewsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const router = useRouter();
  const allowed = user?.role === 'ADMIN' || user?.role === 'STAFF';
  const [filter, setFilter] = useState<StaffReviewFilter>('pending');
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(1);
  useInitialParam('filter', STAFF_REVIEW_FILTERS, setFilter);
  const { data, isLoading, isError } = useStaffReviews({ filter, search: query, page });

  useEffect(() => {
    if (user && !allowed) router.replace('/dashboard');
  }, [user, allowed, router]);
  // Search as the user stops typing, from the first page.
  useEffect(() => {
    const id = setTimeout(() => {
      setQuery(search.trim());
      setPage(1);
    }, 300);
    return () => clearTimeout(id);
  }, [search]);
  if (!allowed) return null;

  const count = (f: StaffReviewFilter) => (f === 'all' || !data ? null : data.counts[f]);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-ink">{t('reviews.title')}</h1>
        <p className="mt-1 max-w-3xl text-sm text-ink/60">{t('reviews.subtitle')}</p>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div role="tablist" aria-label={t('reviews.title')} className="flex flex-wrap gap-1">
          {STAFF_REVIEW_FILTERS.map((f) => {
            const n = count(f);
            return (
              <button
                key={f}
                role="tab"
                aria-selected={filter === f}
                onClick={() => {
                  setFilter(f);
                  setPage(1);
                }}
                className={cn(
                  'flex items-center gap-2 rounded px-3 py-1.5 text-sm font-medium',
                  filter === f ? 'bg-brand-light text-brand-dark' : 'text-ink/70 hover:bg-paper hover:text-ink',
                )}
              >
                {t(`reviews.tabs.${f}`)}
                {n ? <span className="min-w-[1.25rem] rounded-full bg-accent px-1.5 text-center text-xs font-semibold tabular-nums text-white">{n}</span> : null}
              </button>
            );
          })}
        </div>
        <Input type="search" aria-label={t('reviews.search')} placeholder={t('reviews.search')} value={search} onChange={(e) => setSearch(e.target.value)} className="max-w-sm" />
      </div>

      {isLoading && <p className="text-sm text-ink/60">{t('common.loading')}</p>}
      {isError && (
        <p role="alert" className="text-sm text-danger">
          {t('common.actionFailed')}
        </p>
      )}
      {data && data.items.length === 0 && <p className="rounded-lg border border-dashed border-border bg-white p-8 text-center text-sm text-ink/60">{t(`reviews.empty.${filter}`)}</p>}
      {data && data.items.length > 0 && (
        <div className="space-y-3">
          {data.items.map((r) => (
            <StaffReviewCard key={r.id} review={r} />
          ))}
        </div>
      )}
      {data && <ListPagination page={data.page} totalPages={Math.ceil(data.total / data.pageSize)} total={data.total} noun={t('reviews.noun')} onPage={setPage} />}
    </div>
  );
}
