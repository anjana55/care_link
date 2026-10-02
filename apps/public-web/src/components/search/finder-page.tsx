'use client';

import { useRef, useState } from 'react';
import type { SearchRequest } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { LoadingState, EmptyResultsState, ErrorState } from '@/components/common/states';
import { SearchModeToggle, type SearchMode } from '@/components/search/search-mode-toggle';
import { NormalSearchForm } from '@/components/search/normal-search-form';
import { AiSearchPanel } from '@/components/search/ai-search-panel';
import { ResultsList } from '@/components/results/results-list';
import {
  HowItWorksSection,
  TrustSection,
  MultilingualSection,
  CallToActionSection,
} from '@/components/sections/supporting-sections';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { useCaregiverSearch, useSearchConfig } from '@/lib/hooks/use-public-search';

/**
 * The caregiver finder, served at /find.
 *
 * This was previously written out twice - once in app/find/page.tsx and again,
 * almost identically, in app/page.tsx - and the two copies had already drifted
 * (the brand link was a plain span in one and a link in the other). It is a
 * component now so there is a single definition of the search experience.
 */
export function FinderPage() {
  const { t } = useTranslation();
  const { data: config } = useSearchConfig();
  const [mode, setMode] = useState<SearchMode>('normal');
  const [request, setRequest] = useState<SearchRequest | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isError, refetch } = useCaregiverSearch(request);

  function goToPage(page: number) {
    if (!request) return;
    setRequest({ ...request, page });
  }

  function scrollToSearch() {
    searchRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex-1">
        {/* Hero + search - dominates the first screen, per the one-page finder principle */}
        <section className="mx-auto max-w-5xl px-4 pt-10 pb-6 text-center sm:pt-16">
          <h1 className="text-3xl font-bold text-ink sm:text-4xl">{t('hero.title')}</h1>
          <p className="mx-auto mt-3 max-w-xl text-ink/60">{t('hero.subtitle')}</p>
        </section>

        <section ref={searchRef} className="mx-auto max-w-3xl px-4 pb-10">
          <div className="mb-5 flex justify-center">
            <SearchModeToggle
              mode={mode}
              onChange={setMode}
              aiEnabled={Boolean(config?.aiSearchEnabled)}
            />
          </div>

          <div className="rounded-lg border border-border bg-white p-5 sm:p-8">
            {mode === 'normal' ? (
              <NormalSearchForm onSubmit={setRequest} />
            ) : (
              <AiSearchPanel onSubmit={setRequest} />
            )}
          </div>

          <div className="mt-8">
            {isLoading && <LoadingState label={t('loading.searching')} />}
            {isError && <ErrorState onRetry={() => refetch()} />}
            {!isLoading && !isError && data && data.items.length === 0 && (
              <EmptyResultsState onClear={() => setRequest(null)} />
            )}
            {!isLoading && !isError && data && data.items.length > 0 && (
              <ResultsList response={data} onPageChange={goToPage} />
            )}
          </div>
        </section>

        {/* Concise supporting sections - deliberately kept short so search stays central */}
        <HowItWorksSection />
        <TrustSection />
        <MultilingualSection />
        <CallToActionSection onStart={scrollToSearch} />
      </main>

      <SiteFooter />
    </div>
  );
}
