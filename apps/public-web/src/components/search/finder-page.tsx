'use client';

import { useEffect, useRef, useState } from 'react';
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
import { useCaregiverSearch, useMetaSkills, useSearchConfig } from '@/lib/hooks/use-public-search';
import { loadSearch, rememberSearch } from '@/lib/care-intent';

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
  const { data: config, isLoading: configLoading } = useSearchConfig();
  // null until the visitor (or a restored normal search) picks a mode: AI
  // Search is the default whenever it is switched on, Normal Search otherwise.
  const [chosenMode, setChosenMode] = useState<SearchMode | null>(null);
  const [request, setRequest] = useState<SearchRequest | null>(null);
  // Set when the current results came from AI Search: what the visitor typed.
  const [aiQuery, setAiQuery] = useState<string | undefined>(undefined);
  // Bumped when a remembered search is restored, so the form remounts with it.
  const [formKey, setFormKey] = useState(0);
  // Bumped on every new AI search, so the advanced filters below the results re-fill from it.
  const [refineKey, setRefineKey] = useState(0);
  // Set when the visitor changed AI Search's filters by hand, so its chips may no longer tell the whole story.
  const [refined, setRefined] = useState(false);
  const searchRef = useRef<HTMLDivElement>(null);
  const refineRef = useRef<HTMLDivElement>(null);
  const { data: skills = [] } = useMetaSkills();

  // Coming back from a profile ("Back to results") should show the same
  // results, not an empty form. Restored after mount - localStorage is not
  // there during server rendering.
  useEffect(() => {
    const remembered = loadSearch();
    if (!remembered) return;
    setRequest({ ...remembered.request, page: remembered.request.page ?? 1 });
    setAiQuery(remembered.aiQuery);
    // A remembered Normal Search reopens as one; an AI search reopens in the
    // AI panel while AI Search is offered (the default below).
    if (!remembered.aiQuery) setChosenMode('normal');
    setFormKey((k) => k + 1);
  }, []);

  const aiEnabled = Boolean(config?.aiSearchEnabled);
  const mode: SearchMode = aiEnabled ? (chosenMode ?? 'ai') : 'normal';

  /**
   * Runs a search and keeps what it says about the care needed, so a sign-up
   * started from these results can be pre-filled instead of asking again.
   */
  function search(next: SearchRequest, aiQuery?: string, options: { refined?: boolean } = {}) {
    const ids = [...(next.mandatorySkillIds ?? []), ...(next.optionalSkillIds ?? [])];
    const skillNames = [...new Set(ids)].map((id) => skills.find((s) => s.id === id)?.name).filter((n): n is string => Boolean(n));
    rememberSearch({ request: next, aiQuery: aiQuery || undefined, skillNames });
    setAiQuery(aiQuery || undefined);
    setRefined(Boolean(options.refined));
    if (!options.refined) setRefineKey((k) => k + 1);
    setRequest(next);
  }

  function clearSearch() {
    setRequest(null);
    setAiQuery(undefined);
    setRefined(false);
    setFormKey((k) => k + 1);
  }

  const { data, isLoading, isError, refetch } = useCaregiverSearch(request, aiEnabled ? aiQuery : undefined);

  function goToPage(page: number) {
    if (!request) return;
    const next = { ...request, page };
    const remembered = loadSearch();
    rememberSearch({ ...(remembered ?? {}), request: next });
    setRequest(next);
  }

  function scrollToSearch() {
    searchRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  function scrollToRefine() {
    refineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const showAi = mode === 'ai';
  // AI Search puts the caregivers first: the conversation, then the matches,
  // then the full filter form for anyone who wants to fine-tune.
  const showRefine = showAi && request !== null;

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
          {configLoading ? (
            // Wait for the config rather than flash the Normal Search form and then swap it for AI Search.
            <div className="h-64 animate-pulse rounded-lg border border-border bg-white" aria-hidden />
          ) : (
            <>
              <div className="mb-5 flex justify-center">
                <SearchModeToggle mode={mode} onChange={setChosenMode} aiEnabled={aiEnabled} />
              </div>

              <div className="rounded-lg border border-border bg-white p-5 sm:p-8">
                {showAi ? (
                  <AiSearchPanel
                    key={formKey}
                    onSearch={(next, query) => search(next, query)}
                    onUseNormalSearch={() => setChosenMode('normal')}
                    onAdjustFilters={scrollToRefine}
                    onReset={clearSearch}
                    refined={refined}
                    initialQuery={aiQuery}
                    initialRequest={aiQuery && request ? request : undefined}
                  />
                ) : (
                  <NormalSearchForm key={formKey} onSubmit={(next) => search(next)} initialValues={formKey > 0 && request ? request : undefined} />
                )}
              </div>
            </>
          )}

          <div className="mt-8">
            {isLoading && <LoadingState label={t('loading.searching')} />}
            {isError && <ErrorState onRetry={() => refetch()} />}
            {!isLoading && !isError && data && data.items.length === 0 && <EmptyResultsState onClear={clearSearch} />}
            {!isLoading && !isError && data && data.items.length > 0 && (
              <ResultsList response={data} onPageChange={goToPage} />
            )}
          </div>

          {showRefine && request && (
            <div ref={refineRef} className="mt-10 scroll-mt-6 rounded-lg border border-border bg-white p-5 sm:p-8">
              <h2 className="text-lg font-semibold text-ink">{t('aiSearch.refineTitle')}</h2>
              <p className="mb-5 mt-1 text-sm text-ink/60">{t('aiSearch.refineHint')}</p>
              <NormalSearchForm
                key={refineKey}
                initialValues={{ ...request, page: 1 }}
                submitLabel={t('aiSearch.updateResults')}
                onSubmit={(next) => {
                  search(next, aiQuery, { refined: true });
                  scrollToSearch();
                }}
              />
            </div>
          )}
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
