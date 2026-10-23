import { Inject, Injectable } from '@nestjs/common';
import {
  haversineKm,
  roundKm,
  type GeoPoint,
  type Locale,
  type NearestCity,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { cities, districts } from '../database/schema';

/** A city from the reference data, with what distance work needs. */
export interface CityPoint extends GeoPoint {
  id: number;
  districtId: number;
  nameEn: string;
  nameSi: string;
  nameTa: string;
}

/** A district's centre: the mean of its cities' coordinates (the districts table has none of its own). */
export interface DistrictPoint extends GeoPoint {
  id: number;
  nameEn: string;
  nameSi: string;
  nameTa: string;
}

interface Snapshot {
  at: number;
  cities: Map<number, CityPoint>;
  districts: Map<number, DistrictPoint>;
}

/**
 * Reference data rarely changes (only the CSV loader writes it), but nothing
 * tells this process when it does - so it is re-read after a while rather than
 * cached forever.
 */
const SNAPSHOT_TTL_MS = 10 * 60 * 1000;

export function localName(row: { nameEn: string; nameSi: string; nameTa: string }, locale: Locale): string {
  return locale === 'si' ? row.nameSi : locale === 'ta' ? row.nameTa : row.nameEn;
}

/**
 * Distance work over Sri Lanka's ~2,200 cities, done in memory.
 *
 * The whole table is a few hundred kilobytes, and every distance question the
 * search asks ("which cities are within 25 km of here?") is a scan of all of
 * it - cheaper as a loop over a cached array than as a trigonometric
 * expression MySQL would evaluate per row on every search.
 */
@Injectable()
export class GeoService {
  private snapshot: Snapshot | null = null;
  private loading: Promise<Snapshot> | null = null;

  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  private async load(): Promise<Snapshot> {
    if (this.snapshot && Date.now() - this.snapshot.at < SNAPSHOT_TTL_MS) return this.snapshot;
    if (!this.loading) {
      this.loading = (async () => {
        const [cityRows, districtRows] = await Promise.all([
          this.db
            .select({
              id: cities.id,
              districtId: cities.districtId,
              nameEn: cities.nameEn,
              nameSi: cities.nameSi,
              nameTa: cities.nameTa,
              latitude: cities.latitude,
              longitude: cities.longitude,
            })
            .from(cities),
          this.db.select({ id: districts.id, nameEn: districts.nameEn, nameSi: districts.nameSi, nameTa: districts.nameTa }).from(districts),
        ]);
        const cityMap = new Map<number, CityPoint>();
        const sums = new Map<number, { lat: number; lng: number; n: number }>();
        for (const row of cityRows) {
          const latitude = Number(row.latitude);
          const longitude = Number(row.longitude);
          if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) continue;
          cityMap.set(row.id, { ...row, latitude, longitude });
          const sum = sums.get(row.districtId) ?? { lat: 0, lng: 0, n: 0 };
          sum.lat += latitude;
          sum.lng += longitude;
          sum.n += 1;
          sums.set(row.districtId, sum);
        }
        const districtMap = new Map<number, DistrictPoint>();
        for (const row of districtRows) {
          const sum = sums.get(row.id);
          if (!sum) continue;
          districtMap.set(row.id, { ...row, latitude: sum.lat / sum.n, longitude: sum.lng / sum.n });
        }
        return { at: Date.now(), cities: cityMap, districts: districtMap };
      })();
    }
    try {
      this.snapshot = await this.loading;
      return this.snapshot;
    } finally {
      this.loading = null;
    }
  }

  async city(id: number | null | undefined): Promise<CityPoint | null> {
    if (!id) return null;
    return (await this.load()).cities.get(id) ?? null;
  }

  async district(id: number | null | undefined): Promise<DistrictPoint | null> {
    if (!id) return null;
    return (await this.load()).districts.get(id) ?? null;
  }

  /** All cities and district centres, for callers that resolve many points at once. */
  async all(): Promise<{ cities: Map<number, CityPoint>; districts: Map<number, DistrictPoint> }> {
    const { cities: c, districts: d } = await this.load();
    return { cities: c, districts: d };
  }

  /** Ids of every city whose centre is within `radiusKm` of `origin`. */
  async cityIdsWithin(origin: GeoPoint, radiusKm: number): Promise<number[]> {
    const { cities: all } = await this.load();
    const ids: number[] = [];
    for (const city of all.values()) if (haversineKm(origin, city) <= radiusKm) ids.push(city.id);
    return ids;
  }

  /** Ids of every district whose centre is within `radiusKm` of `origin`. */
  async districtIdsWithin(origin: GeoPoint, radiusKm: number): Promise<number[]> {
    const { districts: all } = await this.load();
    const ids: number[] = [];
    for (const district of all.values()) if (haversineKm(origin, district) <= radiusKm) ids.push(district.id);
    return ids;
  }

  /** The city whose centre is closest to `point`, or null when there are no cities at all. */
  async nearestCity(point: GeoPoint, locale: Locale): Promise<NearestCity | null> {
    const { cities: all, districts: ds } = await this.load();
    let best: CityPoint | null = null;
    let bestKm = Infinity;
    for (const city of all.values()) {
      const km = haversineKm(point, city);
      if (km < bestKm) {
        best = city;
        bestKm = km;
      }
    }
    if (!best) return null;
    const district = ds.get(best.districtId);
    return {
      cityId: best.id,
      districtId: best.districtId,
      name: localName(best, locale),
      districtName: district ? localName(district, locale) : '',
      latitude: best.latitude,
      longitude: best.longitude,
      distanceKm: roundKm(bestKm),
    };
  }
}
