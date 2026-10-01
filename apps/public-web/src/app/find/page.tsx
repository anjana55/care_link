'use client';

import { useRef, useState } from 'react';
import Link from 'next/link';
import type { SearchRequest } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { LanguageSwitcher } from '@/components/common/language-switcher';
import { LoadingState, EmptyResultsState, ErrorState } from '@/components/common/states';
import { SearchModeToggle, type SearchMode } from '@/components/search/search-mode-toggle';
import { NormalSearchForm } from '@/components/search/normal-search-form';
import { AiSearchPanel } from '@/components/search/ai-search-panel';
import { ResultsList } from '@/components/results/results-list';
import { HowItWorksSection, TrustSection, MultilingualSection, CallToActionSection } from '@/components/sections/supporting-sections';
import { useCaregiverSearch, useSearchConfig } from '@/lib/hooks/use-public-search';
import { useAuth } from '@/lib/api/auth-context';

export default function HomePage() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const { data: config } = useSearchConfig();
  const [mode, setMode] = useState<SearchMode>('normal');
  const [request, setRequest] = useState<SearchRequest | null>(null);
  const searchRef = useRef<HTMLDivElement>(null);

  const { data, isLoading, isError, refetch } = useCaregiverSearch(request);

  function runSearch(next: SearchRequest) {
    setRequest(next);
  }

  function goToPage(page: number) {
    if (!request) return;
    setRequest({ ...request, page });
  }

  function scrollToSearch() {
    searchRef.current?.scrollIntoView({ behavior: 'smooth' });
  }

  return (
    <main>
      <header className="border-b border-border bg-white/80 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-4 py-3">
          <Link href="/" className="text-sm font-semibold text-brand-dark">
            {t('nav.brand')}
          </Link>
          <div className="flex items-center gap-3">
            <LanguageSwitcher />
            {user ? (
              <button type="button" onClick={logout} className="text-sm font-medium text-ink/60 hover:text-ink">
                {user.email}
              </button>
            ) : (
              <Link href="/login" className="text-sm font-medium text-ink/60 hover:text-ink">
                {t('nav.signIn')}
              </Link>
            )}
          </div>
        </div>
      </header>

      {/* Hero + search - dominates the first screen, per the one-page finder principle */}
      <section className="mx-auto max-w-5xl px-4 pt-10 pb-6 text-center sm:pt-16">
        <h1 className="text-3xl font-bold text-ink sm:text-4xl">{t('hero.title')}</h1>
        <p className="mx-auto mt-3 max-w-xl text-ink/60">{t('hero.subtitle')}</p>
      </section>

      <section ref={searchRef} className="mx-auto max-w-3xl px-4 pb-10">
        <div className="mb-5 flex justify-center">
          <SearchModeToggle mode={mode} onChange={setMode} aiEnabled={Boolean(config?.aiSearchEnabled)} />
        </div>

        <div className="rounded-lg border border-border bg-white p-5 sm:p-8">
          {mode === 'normal' ? (
            <NormalSearchForm onSubmit={runSearch} />
          ) : (
            <AiSearchPanel onSubmit={runSearch} />
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

      <footer className="border-t border-border py-6 text-center text-xs text-ink/40">
        <p className="mx-auto max-w-2xl px-4">{t('footer.disclaimer')}</p>
      </footer>
    </main>
  );
}
