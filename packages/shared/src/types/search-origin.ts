import type { NearestCity } from './geo';
import type { SearchRequest } from './public-search';

/**
 * Where a search measures distances from, shared by the public site and the
 * mobile app so both treat "Use my location" and a client's profile city the
 * same way.
 */

/** The visitor's position (rounded to ~100 m before it leaves the device) plus the city it falls in. */
export interface DeviceLocation {
  latitude: number;
  longitude: number;
  city: NearestCity;
}

export type DeviceLocationError = 'denied' | 'unavailable' | 'outside' | 'unsupported';

/** About 100 m: precise enough to measure distances, never a home address. */
export const roundCoordinate = (value: number) => Math.round(value * 1000) / 1000;

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
