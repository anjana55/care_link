import type {
  Locale,
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
};
