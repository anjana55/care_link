'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { ArrowLeft, HandCoins, Search } from 'lucide-react';
import { careTypeValues } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useCountryNames } from '@/lib/countries';
import { useVacancyBoard, type VacancyFilters } from '@/lib/hooks/use-international';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { VacancyCard } from '@/components/international/vacancy-card';
import { Input, Label, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';

/**
 * The vacancy board: jobs abroad that our team has checked. It never names
 * the employer - the kind of employer, where, and the terms. Caregivers apply
 * from their own account, and our team puts suitable applicants forward.
 */
export default function VacancyBoardPage() {
  const { t } = useTranslation();
  const countries = useCountryNames();
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<VacancyFilters>({});
  const [search, setSearch] = useState('');
  const { data, isLoading, isError } = useVacancyBoard(page, filters);
  useEffect(() => setPage(1), [filters]);
  const pages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader maxWidth="full" />
      <main className="flex-1">
        <section className="bg-accent-dark text-white">
          <div className="mx-auto max-w-5xl px-4 py-10 sm:py-14">
            <Link href="/work-abroad" className="inline-flex items-center gap-1 text-sm text-white/80 hover:text-white">
              <ArrowLeft className="h-4 w-4" aria-hidden />
              {t('vacancies.backToWorkAbroad')}
            </Link>
            <h1 className="mt-4 text-3xl font-bold tracking-tight sm:text-4xl">{t('vacancies.title')}</h1>
            <p className="mt-3 max-w-2xl text-white/85">{t('vacancies.intro')}</p>
            <p className="mt-5 inline-flex items-center gap-2 rounded-full bg-white/15 px-3 py-1.5 text-sm font-medium">
              <HandCoins className="h-4 w-4" aria-hidden />
              {t('vacancies.noFees')}
            </p>
          </div>
        </section>

        <section className="mx-auto max-w-5xl px-4 py-8">
          <form
            role="search"
            className="grid gap-3 rounded-lg border border-border bg-white p-4 sm:grid-cols-[1fr_1fr_1.4fr_auto] sm:items-end"
            onSubmit={(e) => {
              e.preventDefault();
              setFilters((f) => ({ ...f, search: search.trim() || undefined }));
            }}
          >
            <div>
              <Label htmlFor="vb-country">{t('vacancies.filters.country')}</Label>
              <Select id="vb-country" value={filters.country ?? ''} onChange={(e) => setFilters((f) => ({ ...f, country: e.target.value || undefined }))}>
                <option value="">{t('vacancies.filters.anyCountry')}</option>
                {countries.sorted.map((c) => (
                  <option key={c.code} value={c.code}>
                    {c.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="vb-setting">{t('vacancies.filters.setting')}</Label>
              <Select id="vb-setting" value={filters.careSetting ?? ''} onChange={(e) => setFilters((f) => ({ ...f, careSetting: e.target.value || undefined }))}>
                <option value="">{t('vacancies.filters.anySetting')}</option>
                {careTypeValues.map((c) => (
                  <option key={c} value={c}>
                    {t(`careTypes.${c}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="vb-search">{t('vacancies.filters.search')}</Label>
              <Input id="vb-search" value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('vacancies.filters.searchPlaceholder')} maxLength={100} />
            </div>
            <Button type="submit" variant="secondary">
              <Search className="h-4 w-4" aria-hidden />
              {t('vacancies.filters.go')}
            </Button>
          </form>

          <div className="mt-6" aria-live="polite">
            {isLoading && (
              <div className="grid gap-4 sm:grid-cols-2">
                {[0, 1, 2, 3].map((i) => (
                  <div key={i} className="h-44 animate-pulse rounded-lg bg-white" aria-hidden />
                ))}
              </div>
            )}
            {isError && <p className="text-sm text-danger">{t('portal.loadError')}</p>}
            {data && (
              <>
                <p className="mb-3 text-sm text-ink/60">{t('vacancies.count', { count: data.total })}</p>
                {data.items.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-border bg-white p-8 text-center">
                    <p className="text-sm text-ink/60">{t('vacancies.empty')}</p>
                    <Link href="/caregiver/work-abroad" className="mt-3 inline-block text-sm font-semibold text-brand hover:text-brand-dark">
                      {t('vacancies.emptyCta')}
                    </Link>
                  </div>
                ) : (
                  <div className="grid gap-4 sm:grid-cols-2">
                    {data.items.map((v) => (
                      <VacancyCard key={v.reference} vacancy={v} />
                    ))}
                  </div>
                )}
                {pages > 1 && (
                  <nav aria-label={t('vacancies.pages')} className="mt-6 flex items-center justify-center gap-3">
                    <Button variant="secondary" size="sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
                      {t('vacancies.prev')}
                    </Button>
                    <span className="text-sm tabular-nums text-ink/60">
                      {page} / {pages}
                    </span>
                    <Button variant="secondary" size="sm" disabled={page >= pages} onClick={() => setPage((p) => p + 1)}>
                      {t('vacancies.next')}
                    </Button>
                  </nav>
                )}
              </>
            )}
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
