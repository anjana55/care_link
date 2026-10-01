import type {
  PublicCaregiverProfile,
  PublicMetaLanguage,
  PublicMetaLocation,
  PublicMetaSkill,
  PublicSearchConfig,
  PublicSearchResponse,
  SearchRequest,
} from '@care-platform/shared';
import { api } from './client';

export const publicSearchApi = {
  search: (request: SearchRequest) => api.post<PublicSearchResponse>('/public/search', request),
  getCaregiver: (publicId: string) => api.get<PublicCaregiverProfile>(`/public/caregivers/${publicId}`),
  getSkills: () => api.get<PublicMetaSkill[]>('/public/meta/skills'),
  getLanguages: () => api.get<PublicMetaLanguage[]>('/public/meta/languages'),
  getLocations: () => api.get<PublicMetaLocation[]>('/public/meta/locations'),
  getSearchConfig: () => api.get<PublicSearchConfig>('/public/meta/search-config'),
};
