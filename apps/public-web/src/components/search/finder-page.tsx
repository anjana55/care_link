'use client';

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { DEFAULT_SEARCH_RADIUS_KM, type MapCityPoint, type SearchOrigin, type SearchRequest } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { LoadingState, EmptyResultsState, ErrorState } from '@/components/common/states';
import { SearchModeToggle, type SearchMode } from '@/components/search/search-mode-toggle';
import { NormalSearchForm } from '@/components/search/normal-search-form';
import { AiSearchPanel } from '@/components/search/ai-search-panel';
import { ResultsList } from '@/components/results/results-list';
import { LocationError, NearbyControls, NearbySummary, useNearbyMapLabels } from '@/components/results/nearby-panel';
import { CaregiverMap } from '@/components/map/caregiver-map';
import { FindForMeCard } from '@/components/care/find-for-me';
import {
  HowItWorksSection,
  TrustSection,
  MultilingualSection,
  CallToActionSection,
} from '@/components/sections/supporting-sections';
import { SiteHeader } from '@/components/layout/site-header';
import { SiteFooter } from '@/components/layout/site-footer';
import { AdSlot } from '@/components/ads/adsense';
import {
  useCaregiverCoverage,
  useCaregiverSearch,
  useClientSearchOrigin,
  useMetaSkills,
  useSearchConfig,
} from '@/lib/hooks/use-public-search';
import { useDeviceLocation, type DeviceLocation } from '@/lib/hooks/use-device-location';
import { useMediaQuery } from '@/lib/hooks/use-media-query';
import { useIsClient } from '@/lib/hooks/use-client-care';
import { loadSearch, rememberSearch } from '@/lib/care-intent';

/**
 * Adds the signed-in client's profile city as the fallback origin - used only
 * when the search names no city and the visitor is not using their location.
 * Done at request time rather than stored, so it is always the current profile.
 */
export function withProfileOrigin(request: SearchRequest, profileCityId: number | null | undefined): SearchRequest {
  const hasDevice = typeof request.origin?.latitude === 'number' && typeof request.origin?.longitude === 'number';
  if (hasDevice || request.location?.cityId || !profileCityId) return request;
  return { ...request, origin: { cityId: profileCityId } };
}

/**
 * Where the visitor said they are, before they searched, carried into the
 * search they then run. Only fills in what the search left open: a search
 * that names its own place (the AI understood "Kandy", or the form has a
 * district) keeps it, and the visitor's position is then only the point
 * distances are measured from.
 */
export function withDeviceOrigin(request: SearchRequest, here: DeviceLocation | null, radiusKm?: number): SearchRequest {
  if (!here) return request;
  const hasDevice = typeof request.origin?.latitude === 'number' && typeof request.origin?.longitude === 'number';
  if (hasDevice) return request;
  const named = Boolean(request.location?.districtId || request.location?.cityId);
  return {
    ...request,
    ...(named ? {} : { location: { districtId: here.city.districtId, cityId: here.city.cityId } }),
    ...(radiusKm && !request.radiusKm ? { radiusKm } : {}),
    origin: { latitude: here.latitude, longitude: here.longitude },
  };
}

/** Desktop: the map fills the screen and the search floats over its left edge. */
const DESKTOP = '(min-width: 1024px)';
/** Keeps whatever is framed out from under the floating panel (its width plus its gutters). */
const PANEL_CLEARANCE = { top: 48, right: 48, bottom: 48, left: 440 + 24 + 32 };

interface FinderPageProps {
  /**
   * The landing page shows the brand instead of a back link and puts its own
   * sections under the map; /find keeps the finder's supporting sections.
   */
  variant?: 'find' | 'landing';
  /** Rendered under the map in place of the finder's own supporting sections. */
  children?: ReactNode;
}

/**
 * The caregiver finder - map first.
 *
 * Modelled on ride-hailing apps: the map is the page, and the search floats
 * over it in a panel (a bottom sheet on phones). Before anything is searched
 * the map already shows where caregivers are, so the first thing a visitor
 * sees is that there are people near them. Searching (AI or Normal) re-draws
 * the map around the search location and lists the matches in the panel.
 *
 * Served at /find and, with the landing page's sections underneath, at /.
 */
export function FinderPage({ variant = 'find', children }: FinderPageProps = {}) {
  const { t, locale } = useTranslation();
  const isDesktop = useMediaQuery(DESKTOP);
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
  // "Use my location" pressed before searching: drawn on the map now, used by the next search.
  const [here, setHere] = useState<DeviceLocation | null>(null);
  const [previewRadius, setPreviewRadius] = useState<number>(DEFAULT_SEARCH_RADIUS_KM);
  const panelRef = useRef<HTMLDivElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const refineRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<HTMLDivElement>(null);
  const { data: skills = [] } = useMetaSkills();
  const { data: coverage = [] } = useCaregiverCoverage(locale);

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
  const device = useDeviceLocation(locale);

  /**
   * Runs a search and keeps what it says about the care needed, so a sign-up
   * started from these results can be pre-filled instead of asking again.
   */
  function search(next: SearchRequest, aiQuery?: string, options: { refined?: boolean } = {}) {
    next = withDeviceOrigin(next, here, previewRadius);
    const ids = [...(next.mandatorySkillIds ?? []), ...(next.optionalSkillIds ?? [])];
    const skillNames = [...new Set(ids)].map((id) => skills.find((s) => s.id === id)?.name).filter((n): n is string => Boolean(n));
    rememberSearch({ request: next, aiQuery: aiQuery || undefined, skillNames });
    setAiQuery(aiQuery || undefined);
    setRefined(Boolean(options.refined));
    if (!options.refined) setRefineKey((k) => k + 1);
    setShownOnMap(null);
    device.clearError();
    setRequest(next);
  }

  function clearSearch() {
    setRequest(null);
    setAiQuery(undefined);
    setRefined(false);
    setFormKey((k) => k + 1);
  }

  const client = useIsClient();
  const { data: profileOrigin } = useClientSearchOrigin(client?.patientId ?? null);
  const effectiveRequest = useMemo(() => (request ? withProfileOrigin(request, profileOrigin?.cityId) : null), [request, profileOrigin?.cityId]);
  const { data, isLoading, isError, refetch } = useCaregiverSearch(effectiveRequest, aiEnabled ? aiQuery : undefined);

  // The caregiver whose home and service area are drawn on the map.
  const [shownOnMap, setShownOnMap] = useState<string | null>(null);
  const highlighted = useMemo(() => data?.items.find((i) => i.publicId === shownOnMap) ?? null, [data, shownOnMap]);

  function showOnMap(publicId: string | null) {
    setShownOnMap(publicId);
    // On desktop the map is always in view beside the panel; on a phone it is above the results.
    if (publicId && !isDesktop) mapRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /** Same search, a different reach - or, before searching, a bigger circle around the visitor. */
  function changeRadius(radiusKm: number) {
    if (!request) {
      setPreviewRadius(radiusKm);
      return;
    }
    setShownOnMap(null);
    search({ ...request, radiusKm, page: 1 }, aiQuery, { refined: refined });
  }

  /**
   * "Use my location". With results on screen it searches again around where
   * the visitor is: the district and city become the ones they are in (so the
   * form, the AI chips and a sign-up started from these results all agree),
   * and the exact point is the origin distances are measured from. Before a
   * search it centres the map on them and the next search starts from there.
   */
  async function locateMe() {
    const found = await device.locate();
    if (!found) return;
    setHere(found);
    if (!request) return;
    setShownOnMap(null);
    search(
      {
        ...request,
        location: { districtId: found.city.districtId, cityId: found.city.cityId },
        origin: { latitude: found.latitude, longitude: found.longitude },
        page: 1,
      },
      aiQuery,
    );
  }

  function goToPage(page: number) {
    if (!request) return;
    const next = { ...request, page };
    const remembered = loadSearch();
    rememberSearch({ ...(remembered ?? {}), request: next });
    setShownOnMap(null);
    setRequest(next);
    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function scrollToSearch() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
    panelRef.current?.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function scrollToRefine() {
    refineRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  const showAi = mode === 'ai';
  // AI Search puts the caregivers first: the conversation, then the matches,
  // then the full filter form for anyone who wants to fine-tune.
  const showRefine = showAi && request !== null;
  const hasResults = !isLoading && !isError && Boolean(data);

  // What the map draws. Results win once there are some; until then, where
  // caregivers are, around the visitor if they have said where that is.
  const previewOrigin: SearchOrigin | null = useMemo(
    () => (here ? { latitude: here.latitude, longitude: here.longitude, source: 'device', label: here.city.name, radiusKm: previewRadius } : null),
    [here, previewRadius],
  );
  const mapOrigin = data ? (data.origin ?? null) : previewOrigin;
  const mapPoints: MapCityPoint[] = useMemo(() => (data ? (data.mapPoints ?? []) : coverage), [data, coverage]);
  const highlight = useMemo(
    () => (highlighted ? { home: highlighted.homeLocation, serviceArea: highlighted.serviceArea } : null),
    [highlighted],
  );
  const mapLabels = useNearbyMapLabels(mapOrigin);
  const coverageTotal = coverage.reduce((sum, p) => sum + p.count, 0);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader maxWidth="full" showBackLink={variant !== 'landing'} />

      <main className="flex-1">
        <section className="relative lg:h-[calc(100dvh-3.6rem)] lg:min-h-[600px]">
          {/* The map: the top of the page on a phone, the whole of it on desktop. */}
          <div ref={mapRef} className="relative h-[45vh] min-h-[300px] scroll-mt-16 lg:absolute lg:inset-0 lg:h-auto">
            <CaregiverMap
              className="relative h-full w-full bg-paper"
              origin={mapOrigin}
              points={mapPoints}
              highlight={highlight}
              labels={mapLabels}
              locale={locale}
              padding={isDesktop ? PANEL_CLEARANCE : { top: 64, right: 24, bottom: 40, left: 24 }}
              gestures={isDesktop ? 'free' : 'cooperative'}
              legend="overlay"
            />
            <NearbyControls
              className="absolute left-3 top-3 z-[2] lg:left-[calc(440px+3rem)] lg:top-6"
              origin={mapOrigin}
              onUseMyLocation={locateMe}
              locating={device.locating}
              onRadiusChange={mapOrigin ? changeRadius : undefined}
            />
          </div>

          {/* The search: a sheet over the bottom of the map on a phone, a floating panel on desktop. */}
          <div
            ref={panelRef}
            className="relative z-10 -mt-6 rounded-t-3xl bg-white px-4 pb-8 pt-3 shadow-[0_-10px_30px_-12px_rgba(0,0,0,0.25)] lg:absolute lg:left-6 lg:top-6 lg:mt-0 lg:max-h-[calc(100%-3rem)] lg:w-[440px] lg:overflow-y-auto lg:overscroll-contain lg:rounded-2xl lg:px-6 lg:pb-6 lg:pt-6 lg:shadow-2xl"
          >
            <div className="mx-auto mb-4 h-1.5 w-10 rounded-full bg-border lg:hidden" aria-hidden />

            <h1 className="text-2xl font-bold tracking-tight text-ink">{t('hero.title')}</h1>
            <p className="mt-1 text-sm text-ink/60">{t('hero.subtitle')}</p>
            {!data && coverageTotal > 0 && (
              <p className="mt-3 inline-flex items-center gap-2 rounded-full bg-brand-light px-3 py-1 text-xs font-semibold text-brand-dark">
                <span className="h-2 w-2 rounded-full bg-brand" aria-hidden />
                {coverageTotal === 1 ? t('map.coverageTotalOne') : t('map.coverageTotalOther', { count: coverageTotal, places: coverage.length })}
              </p>
            )}

            <div className="mt-5">
              {configLoading ? (
                // Wait for the config rather than flash the Normal Search form and then swap it for AI Search.
                <div className="h-56 animate-pulse rounded-lg bg-paper" aria-hidden />
              ) : (
                <>
                  <SearchModeToggle mode={mode} onChange={setChosenMode} aiEnabled={aiEnabled} fullWidth />
                  <div className="mt-4">
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
                      <NormalSearchForm
                        key={formKey}
                        compact
                        onSubmit={(next) => search(next)}
                        initialValues={formKey > 0 && request ? request : undefined}
                      />
                    )}
                  </div>
                </>
              )}
            </div>

            {!data && device.error && <LocationError error={device.error} />}

            <div ref={resultsRef} className="scroll-mt-20">
              {isLoading && (
                <div className="mt-6">
                  <LoadingState label={t('loading.searching')} />
                </div>
              )}
              {isError && (
                <div className="mt-6">
                  <ErrorState onRetry={() => refetch()} />
                </div>
              )}
              {hasResults && data && (
                <div className="mt-6 space-y-4 border-t border-border pt-5">
                  <NearbySummary response={data} onRadiusChange={changeRadius} locationError={device.error} />
                  {data.items.length === 0 && <EmptyResultsState onClear={clearSearch} />}
                  {data.items.length > 0 && (
                    <ResultsList compact response={data} onPageChange={goToPage} shownOnMap={shownOnMap} onShowOnMap={showOnMap} />
                  )}
                  {/* Nobody suitable on screen? Our team can look for them. */}
                  <FindForMeCard prominent={data.total < 3} />
                  {data.items.length > 0 && <AdSlot placement="search" className="px-0" />}
                </div>
              )}
            </div>

            {showRefine && request && (
              <div ref={refineRef} className="mt-8 scroll-mt-6 border-t border-border pt-5">
                <h2 className="text-lg font-semibold text-ink">{t('aiSearch.refineTitle')}</h2>
                <p className="mb-5 mt-1 text-sm text-ink/60">{t('aiSearch.refineHint')}</p>
                <NormalSearchForm
                  key={refineKey}
                  compact
                  initialValues={{ ...request, page: 1 }}
                  submitLabel={t('aiSearch.updateResults')}
                  onSubmit={(next) => {
                    search(next, aiQuery, { refined: true });
                    resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                />
              </div>
            )}

            {/* Caregivers land here too: the way in for them stays one tap away. */}
            <p className="mt-8 border-t border-border pt-4 text-sm text-ink/60">
              {t('finder.caregiverPrompt')}{' '}
              <Link href="/caregiver/signup" className="inline-flex items-center gap-1 font-semibold text-brand hover:text-brand-dark">
                {t('landing.ctaRegister')}
                <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </Link>
            </p>
          </div>
        </section>

        {children ?? (
          <>
            {/* Concise supporting sections - deliberately kept short so search stays central */}
            <HowItWorksSection />
            <TrustSection />
            <MultilingualSection />
            <CallToActionSection onStart={scrollToSearch} />
          </>
        )}
      </main>

      <SiteFooter />
    </div>
  );
}
