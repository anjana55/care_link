import { useQuery } from '@tanstack/react-query';
import type { SearchRequest } from '@care-platform/shared';
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

export function useMetaLocations() {
  return useQuery({ queryKey: ['meta-locations'], queryFn: publicSearchApi.getLocations, staleTime: 5 * 60 * 1000 });
}

export function useCaregiverSearch(request: SearchRequest | null) {
  return useQuery({
    queryKey: ['public-search', request],
    queryFn: () => publicSearchApi.search(request!),
    enabled: request !== null,
  });
}

export function useCaregiverProfile(publicId: string | null) {
  return useQuery({
    queryKey: ['public-caregiver', publicId],
    queryFn: () => publicSearchApi.getCaregiver(publicId!),
    enabled: publicId !== null,
  });
}
