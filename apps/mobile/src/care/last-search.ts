import type { CreateCareRequestBody, SearchRequest } from '@care-platform/shared';

/**
 * What the client last searched for, carried into a request so they aren't
 * asked again (the website does the same). Kept for this app session only.
 */
let last: SearchRequest | null = null;

export function rememberSearch(request: SearchRequest | null) {
  last = request;
}

export function detailsFromLastSearch(): Pick<CreateCareRequestBody, 'careType' | 'districtId' | 'cityId' | 'desiredStartDate'> {
  if (!last) return {};
  return {
    ...(last.careType ? { careType: last.careType } : {}),
    ...(last.location?.districtId ? { districtId: last.location.districtId } : {}),
    ...(last.location?.cityId ? { cityId: last.location.cityId } : {}),
    ...(last.desiredStartDate ? { desiredStartDate: last.desiredStartDate } : {}),
  };
}
