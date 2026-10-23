/**
 * Distances and map shapes shared by the API (which computes them), the public
 * site and the staff app (which draw them).
 *
 * Everything is city-level: a caregiver is placed at the centre of the city
 * they live in (or of their district, when no city is on record), never at an
 * address. Distances are straight-line kilometres between those points.
 */

/** Radius choices offered in the UI. The API accepts any whole number up to MAX_SEARCH_RADIUS_KM. */
export const SEARCH_RADIUS_OPTIONS_KM = [5, 10, 25, 50, 100] as const;
export const DEFAULT_SEARCH_RADIUS_KM = 25;
export const MAX_SEARCH_RADIUS_KM = 200;

/**
 * A device location further than this from every known city is not used as a
 * search origin - it is somewhere the platform has no caregivers to measure
 * against (or the browser reported something wrong).
 */
export const MAX_DEVICE_DISTANCE_FROM_CITY_KM = 50;

/** Where the distances in a search are measured from, in order of preference. */
export const originSourceValues = ['device', 'searchCity', 'profileCity', 'district'] as const;
export type OriginSource = (typeof originSourceValues)[number];

export interface GeoPoint {
  latitude: number;
  longitude: number;
}

/** `city` = the centre of the caregiver's city; `district` = no city on record, so the district's centre. */
export type LocationPrecision = 'city' | 'district';

export interface SearchOrigin extends GeoPoint {
  source: OriginSource;
  /** The city or district the origin is (or is nearest to), in the visitor's language. */
  label: string | null;
  radiusKm: number;
}

/** One place on the results map: every matching caregiver who lives there, as a count. */
export interface MapCityPoint extends GeoPoint {
  /** Stable key: `c<cityId>` or `d<districtId>`. */
  key: string;
  name: string | null;
  count: number;
  distanceKm: number | null;
  precision: LocationPrecision;
}

/** A city a caregiver will travel to work in. */
export interface ServiceAreaCity extends GeoPoint {
  cityId: number;
  name: string;
  distanceKm: number | null;
}

export interface CaregiverHomeLocation extends GeoPoint {
  precision: LocationPrecision;
}

/** POST /public/geo/nearest-city */
export interface NearestCityRequest extends GeoPoint {
  locale?: string;
}

export interface NearestCity extends GeoPoint {
  cityId: number;
  districtId: number;
  name: string;
  districtName: string;
  /** From the point asked about to this city's centre. */
  distanceKm: number;
}

/** GET /me/search-origin - the signed-in client's profile location, for distance fallback. */
export interface ClientSearchOrigin {
  districtId: number | null;
  cityId: number | null;
}

const EARTH_RADIUS_KM = 6371.0088;

/** Great-circle ("as the crow flies") distance in kilometres. */
export function haversineKm(a: GeoPoint, b: GeoPoint): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.latitude - a.latitude);
  const dLng = toRad(b.longitude - a.longitude);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.latitude)) * Math.cos(toRad(b.latitude)) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Kilometres to one decimal place - the precision every distance is shown and returned at. */
export function roundKm(km: number): number {
  return Math.round(km * 10) / 10;
}
