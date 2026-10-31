import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import type {
  AiSearchResponse,
  ExtractedRequirements,
  Locale,
  PublicCaregiverProfile,
  PublicLocationTree,
  PublicMetaCity,
  PublicMetaSkill,
  PublicSearchConfig,
  PublicSearchResponse,
  SearchRequest,
} from '@care-platform/shared';
import { api } from '@/api';
import type { QueryParams } from '@/api/client';

/**
 * The public search endpoints the website's finder uses. All of them work
 * signed out, so they're called without the session: an expired one can never
 * get in the way of searching.
 */
const get = <T>(path: string, params?: QueryParams) => api.request<T>(path, { params, anonymous: true });
const post = <T>(path: string, body: unknown) => api.request<T>(path, { method: 'POST', body, anonymous: true });

export const PAGE_SIZE = 20;
const RARELY_CHANGES = 5 * 60 * 1000;

export const searchApi = {
  config: () => get<PublicSearchConfig>('/public/meta/search-config'),
  skills: () => get<PublicMetaSkill[]>('/public/meta/skills'),
  // Province -> district only; the cities of a district are fetched when it is chosen.
  locationTree: (locale: Locale) => get<PublicLocationTree>('/public/meta/locations/tree', { locale }),
  cities: (districtId: number, locale: Locale) => get<PublicMetaCity[]>('/public/meta/locations/cities', { districtId, locale }),
  search: (request: SearchRequest) => post<PublicSearchResponse>('/public/search', request),
  // AI Search: the visitor's words -> requirements they can see, then a search the AI may re-order.
  aiExtract: (query: string, locale: Locale) => post<ExtractedRequirements>('/public/ai/extract', { query, locale }),
  aiSearch: (request: SearchRequest, query: string) => post<AiSearchResponse>('/public/ai/search', { request, query }),
  caregiver: (publicId: string, locale: Locale) => get<PublicCaregiverProfile>(`/public/caregivers/${encodeURIComponent(publicId)}`, { locale }),
};

export function useSearchConfig() {
  return useQuery({ queryKey: ['public-search-config'], queryFn: searchApi.config, staleTime: RARELY_CHANGES });
}

export function useSkills() {
  return useQuery({ queryKey: ['meta-skills'], queryFn: searchApi.skills, staleTime: RARELY_CHANGES });
}

/** Keyed by language: the names come back in it, so switching language must ask again. */
export function useDistricts(locale: Locale) {
  return useQuery({
    queryKey: ['locations', 'tree', locale],
    queryFn: () => searchApi.locationTree(locale),
    staleTime: RARELY_CHANGES,
    select: (tree) => tree.flatMap((p) => p.districts).sort((a, b) => a.name.localeCompare(b.name, locale)),
  });
}

export function useCities(districtId: number | null, locale: Locale) {
  return useQuery({
    queryKey: ['locations', 'cities', districtId, locale],
    queryFn: () => searchApi.cities(districtId!, locale),
    enabled: districtId !== null,
    staleTime: RARELY_CHANGES,
  });
}

/**
 * A search, a page at a time ("Show more"). With `aiQuery` (everything the
 * visitor said in AI Search) the AI search endpoint runs it: the same hard
 * filters, with the matches re-ordered.
 */
export function useCaregiverSearch(request: SearchRequest | null, aiQuery: string | null, locale: Locale) {
  return useInfiniteQuery({
    queryKey: ['public-search', request, aiQuery, locale],
    enabled: request !== null,
    initialPageParam: 1,
    queryFn: ({ pageParam }) => {
      const page = { ...request!, locale, page: pageParam, pageSize: PAGE_SIZE };
      return aiQuery ? searchApi.aiSearch(page, aiQuery) : searchApi.search(page);
    },
    getNextPageParam: (last) => (last.page < last.totalPages ? last.page + 1 : undefined),
  });
}

export function useCaregiverProfile(publicId: string | null, locale: Locale) {
  return useQuery({
    queryKey: ['public-caregiver', publicId, locale],
    queryFn: () => searchApi.caregiver(publicId!, locale),
    enabled: Boolean(publicId),
  });
}
