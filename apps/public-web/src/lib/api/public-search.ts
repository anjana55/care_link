import type {
  ClientSearchOrigin,
  NearestCity,
  NearestCityRequest,
  AiSearchRequestBody,
  AiSearchResponse,
  ExtractedRequirements,
  Locale,
  MapCityPoint,
  PublicCaregiverProfile,
  PublicMetaCity,
  PublicMetaLanguage,
  PublicMetaSkill,
  PublicLocationTree,
  PublicSearchConfig,
  PublicSearchResponse,
  SearchRequest,
} from '@care-platform/shared';
import { api } from './client';

export const publicSearchApi = {
  search: (request: SearchRequest) => api.post<PublicSearchResponse>('/public/search', request),
  getCaregiver: (publicId: string, locale?: Locale) =>
    api.get<PublicCaregiverProfile>(`/public/caregivers/${publicId}`, { locale }),
  getSkills: () => api.get<PublicMetaSkill[]>('/public/meta/skills'),
  getLanguages: () => api.get<PublicMetaLanguage[]>('/public/meta/languages'),
  // Province -> district only. The cities underneath are fetched per district
  // so a dropdown never pulls all 2155 of them.
  getLocationTree: (locale?: Locale) => api.get<PublicLocationTree>('/public/meta/locations/tree', { locale }),
  getCities: (districtId: number, locale?: Locale) =>
    api.get<PublicMetaCity[]>('/public/meta/locations/cities', { districtId, locale }),
  getSearchConfig: () => api.get<PublicSearchConfig>('/public/meta/search-config'),
  // Where listed caregivers live, as city-level counts - the map before any search.
  getCoverage: (locale?: Locale) => api.get<MapCityPoint[]>('/public/meta/coverage', { locale }),
  // "Use my location": a POST so the coordinates never appear in a URL or an access log.
  nearestCity: (body: NearestCityRequest) => api.post<NearestCity>('/public/geo/nearest-city', body),
  // Signed-in clients only: the profile city distances fall back to.
  clientSearchOrigin: () => api.get<ClientSearchOrigin>('/me/search-origin'),
  // AI Search: the visitor's words -> structured requirements they can check,
  // then a search whose hard-filtered results the AI may re-order.
  aiExtract: (query: string, locale?: Locale) => api.post<ExtractedRequirements>('/public/ai/extract', { query, locale }),
  aiSearch: (body: AiSearchRequestBody) => api.post<AiSearchResponse>('/public/ai/search', body),
};
