import { drizzle } from 'drizzle-orm/mysql-proxy';
import { PublicSearchService } from './public-search.service';
import type { RankingService } from './ranking/ranking.service';
import type { GeoService } from '../geo/geo.service';
import * as schema from '../database/schema';
import type { Database } from '../database/database.module';

/**
 * The landing map's caregiver counts (GET /public/meta/coverage).
 *
 * Driven through Drizzle's real query builder (mysql-proxy), so the assertions
 * see the SQL the service actually sends - in particular that it is filtered
 * to publicly listed caregivers and only ever selects place ids and a count.
 */

const NEGOMBO = { id: 10, districtId: 2, nameEn: 'Negombo', nameSi: 'මීගමුව', nameTa: 'நீர்கொழும்பு', latitude: 7.2083, longitude: 79.8358 };
const KANDY = { id: 20, districtId: 5, nameEn: 'Kandy', nameSi: 'මහනුවර', nameTa: 'கண்டி', latitude: 7.2906, longitude: 80.6337 };
const GALLE_DISTRICT = { id: 3, nameEn: 'Galle', nameSi: 'ගාල්ල', nameTa: 'காலி', latitude: 6.05, longitude: 80.22 };

function setup(rows: [number | null, number | null, number][]) {
  const queries: { sql: string; params: unknown[] }[] = [];
  const db = drizzle(
    async (sql, params) => {
      queries.push({ sql, params });
      return { rows: rows.map((r) => [...r]) };
    },
    { schema },
  ) as unknown as Database;
  const geo = {
    all: jest.fn().mockResolvedValue({
      cities: new Map([
        [NEGOMBO.id, NEGOMBO],
        [KANDY.id, KANDY],
      ]),
      districts: new Map([[GALLE_DISTRICT.id, GALLE_DISTRICT]]),
    }),
  } as unknown as GeoService;
  const service = new PublicSearchService(db, {} as RankingService, geo);
  return { service, queries };
}

describe('PublicSearchService.coverage', () => {
  it('groups listed caregivers by home city, falling back to the district centre', async () => {
    const { service } = setup([
      [NEGOMBO.id, 2, 4],
      [KANDY.id, 5, 1],
      [null, GALLE_DISTRICT.id, 2],
      // A city the reference data does not know is skipped, not drawn at 0,0.
      [999, 9, 3],
      // Nowhere on record at all.
      [null, null, 6],
    ]);

    const points = await service.coverage('en');

    expect(points).toEqual([
      { key: 'c10', latitude: NEGOMBO.latitude, longitude: NEGOMBO.longitude, precision: 'city', name: 'Negombo', distanceKm: null, count: 4 },
      { key: 'd3', latitude: GALLE_DISTRICT.latitude, longitude: GALLE_DISTRICT.longitude, precision: 'district', name: 'Galle', distanceKm: null, count: 2 },
      { key: 'c20', latitude: KANDY.latitude, longitude: KANDY.longitude, precision: 'city', name: 'Kandy', distanceKm: null, count: 1 },
    ]);
  });

  it("names places in the visitor's language", async () => {
    const { service } = setup([[NEGOMBO.id, 2, 1]]);
    await expect(service.coverage('ta')).resolves.toEqual([expect.objectContaining({ name: 'நீர்கொழும்பு' })]);
  });

  it('only counts publicly listed caregivers and selects nothing but places and a count', async () => {
    const { service, queries } = setup([]);
    await service.coverage('en');

    expect(queries).toHaveLength(1);
    const { sql } = queries[0];
    expect(sql).toMatch(/`deleted_at` is null/i);
    expect(sql).toMatch(/`status` in/i);
    const selected = /select (.+?) from /i.exec(sql)![1];
    expect(selected).not.toMatch(/public_id|`id`|name|phone|email/i);
  });

  it('reuses the answer for a few minutes instead of re-querying on every landing-page view', async () => {
    const { service, queries } = setup([[NEGOMBO.id, 2, 1]]);
    await service.coverage('en');
    await service.coverage('en');
    expect(queries).toHaveLength(1);
  });
});
