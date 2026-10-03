import { useQuery } from '@tanstack/react-query';
import type { Locale, SearchRequest } from '@care-platform/shared';
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

export function useCaregiverSearch(request: SearchRequest | null) {
  return useQuery({
    queryKey: ['public-search', request],
    queryFn: () => publicSearchApi.search(request!),
    enabled: request !== null,
  });
}

export function useCaregiverProfile(publicId: string | null, locale: Locale) {
  return useQuery({
    queryKey: ['public-caregiver', publicId, locale],
    queryFn: () => publicSearchApi.getCaregiver(publicId!, locale),
    enabled: publicId !== null,
  });
}
