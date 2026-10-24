import { useQuery } from '@tanstack/react-query';
import type { Locale, SearchRequest } from '@care-platform/shared';
import { searchRequestSchema } from '@care-platform/shared';
import { publicSearchApi } from '../api/public-search';

export function useSearchConfig() {
  return useQuery({
    queryKey: ['public-search-config'],
    queryFn: publicSearchApi.getSearchConfig,
    // Rarely changes; avoid re-fetching on every focus.
    staleTime: 5 * 60 * 1000,
  });
}

export function useMetaSkills() {
  return useQuery({ queryKey: ['meta-skills'], queryFn: publicSearchApi.getSkills, staleTime: 5 * 60 * 1000 });
}

export function useMetaLanguages() {
  return useQuery({ queryKey: ['meta-languages'], queryFn: publicSearchApi.getLanguages, staleTime: 5 * 60 * 1000 });
}

/**
 * Province -> district, named in `locale`.
 *
 * `locale` is passed in rather than read from a client-side global because it
 * has to appear in the query key as well as the query string: keyed only by
 * path, switching language would serve the previous language's Sinhala-free
 * names straight out of the cache without ever asking the API again.
 */
export function useLocationTree(locale: Locale) {
  return useQuery({
    queryKey: ['locations', 'tree', locale],
    queryFn: () => publicSearchApi.getLocationTree(locale),
    staleTime: 5 * 60 * 1000,
  });
}

/** The cities of one district, named in `locale`. Disabled until a district
 * is chosen so the form does not pull every city in the country. */
export function useCities(districtId: number | null, locale: Locale) {
  return useQuery({
    queryKey: ['locations', 'cities', districtId, locale],
    queryFn: () => publicSearchApi.getCities(districtId!, locale),
    enabled: districtId !== null,
    staleTime: 5 * 60 * 1000,
  });
}

/**
 * Runs a search. With `aiQuery` (the visitor's own words from AI Search) the
 * results come from the AI search endpoint, which applies exactly the same
 * hard filters and only re-orders the matches; without it, Normal Search.
 */
/**
 * Runs a search - but only one the API will accept. A request missing a
 * required field (for example a search remembered on this device from before
 * the type of care became required) is never sent: it would only come back as
 * a 400 and "Something went wrong", and "Try again" would resend it unchanged.
 */
export function useCaregiverSearch(request: SearchRequest | null, aiQuery?: string) {
  const runnable = request !== null && isRunnableSearch(request);
  return useQuery({
    queryKey: ['public-search', request, aiQuery ?? null],
    queryFn: () => (aiQuery ? publicSearchApi.aiSearch({ request: request!, query: aiQuery }) : publicSearchApi.search(request!)),
    enabled: runnable,
  });
}

/** Whether a request has everything the search API requires (care type, district, start date). */
export function isRunnableSearch(request: SearchRequest): boolean {
  return searchRequestSchema.safeParse(request).success;
}

export function useCaregiverProfile(publicId: string | null, locale: Locale) {
  return useQuery({
    queryKey: ['public-caregiver', publicId, locale],
    queryFn: () => publicSearchApi.getCaregiver(publicId!, locale),
    enabled: publicId !== null,
  });
}

/**
 * A signed-in client's profile city - where distances are measured from when
 * they searched without naming a city (and are not using their location).
 */
export function useClientSearchOrigin(patientId: string | null) {
  return useQuery({
    // Keyed by the client, so signing in as someone else never reuses the last one's city.
    queryKey: ['client', patientId, 'search-origin'],
    queryFn: publicSearchApi.clientSearchOrigin,
    enabled: patientId !== null,
    staleTime: 5 * 60 * 1000,
  });
}
