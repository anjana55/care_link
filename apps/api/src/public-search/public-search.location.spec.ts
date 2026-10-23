import { drizzle } from 'drizzle-orm/mysql-proxy';
import { PublicSearchService } from './public-search.service';
import { RankingService } from './ranking/ranking.service';
import { GeoService } from '../geo/geo.service';
import * as schema from '../database/schema';
import type { Database } from '../database/database.module';
import type { SearchRequestDto } from './dto/search-request.dto';

/**
 * The location filter, driven through the real Drizzle query builder.
 *
 * This is not a hand-written stub. `mysql-proxy` is Drizzle's own driver, so
 * the service builds genuine SQL against the genuine schema and the only
 * thing faked is the database's answer. That matters here because the bug
 * this pins was a *semantic* one - the filter compared city and district
 * **strings**, case-sensitively and untrimmed, while the ranking compared the
 * same two things lowercased and trimmed. A stub that returns rows I chose
 * would happily pass while the old string comparison was still in place,
 * because the stub never evaluates the WHERE clause. The generated SQL and
 * its bound parameters can: if the predicate stops being `city_id = ?`, the
 * assertion fails.
 */

// Real coordinates (approximate city centres), so the distances below are
// the ones the platform would compute: Dehiwala-Colombo ~9 km,
// Dehiwala-Moratuwa ~9 km, Dehiwala-Gampaha ~33 km, Dehiwala-Galle ~96 km.
const DEHIWALA = {
  id: 340,
  districtId: 1,
  nameEn: 'Dehiwala',
  nameSi: 'දෙහිවල',
  nameTa: 'தேவிவாலை',
  postcode: '10350',
  latitude: 6.8511,
  longitude: 79.8659,
};
const COLOMBO_CITY = { id: 1, districtId: 1, nameEn: 'Colombo', nameSi: 'කොළඹ', nameTa: 'கொழும்பு', latitude: 6.9319, longitude: 79.8478 };
const MORATUWA = { id: 654, districtId: 1, nameEn: 'Moratuwa', nameSi: 'මොරටුව', nameTa: 'மொரட்டுவை', latitude: 6.773, longitude: 79.8816 };
const GAMPAHA = { id: 548, districtId: 2, nameEn: 'Gampaha', nameSi: 'ගම්පහ', nameTa: 'கம்பஹா', latitude: 7.084, longitude: 80.0098 };
const GALLE = { id: 900, districtId: 3, nameEn: 'Galle', nameSi: 'ගාල්ල', nameTa: 'காலி', latitude: 6.0535, longitude: 80.221 };
const ALL_CITIES = [DEHIWALA, COLOMBO_CITY, MORATUWA, GAMPAHA, GALLE];

const COLOMBO_DISTRICT = {
  id: 1,
  provinceId: 1,
  nameEn: 'Colombo',
  nameSi: 'කොළඹ',
  nameTa: 'கொழும்பு',
};
const GAMPAHA_DISTRICT = { id: 2, provinceId: 1, nameEn: 'Gampaha', nameSi: 'ගම්පහ', nameTa: 'கம்பஹா' };
const GALLE_DISTRICT = { id: 3, provinceId: 2, nameEn: 'Galle', nameSi: 'ගාල්ල', nameTa: 'காலி' };
const ALL_DISTRICTS = [COLOMBO_DISTRICT, GAMPAHA_DISTRICT, GALLE_DISTRICT];

/**
 * Column names the generated SQL selects, in order.
 *
 * The last dotted segment is what matters: a joined column arrives qualified
 * as `cities`.`name_en`, and reading that whole string as a key would find
 * nothing and silently return null for every joined field.
 */
function selectedColumns(sql: string): string[] {
  const match = /select (.+?) from /i.exec(sql);
  if (!match) return [];
  return match[1].split(',').map((c) => c.trim().replace(/`/g, '').split('.').pop() ?? '');
}

/** `name_en` -> `nameEn`, so fixtures can be written either way. */
function camel(column: string): string {
  return column.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase());
}

/**
 * A fixture row's value for a selected column, accepting both the SQL spelling
 * and the camelCase one. Returns undefined when genuinely absent, so the
 * caller can substitute null - which matters, because a null and a missing
 * key mean the same thing here but a wrong lookup would too.
 */
function valueFor(row: Row, column: string): unknown {
  if (column in row) return row[column];
  const camelKey = camel(column);
  return camelKey in row ? row[camelKey] : undefined;
}

type Row = Record<string, unknown>;

interface QueryLog {
  sql: string;
  params: unknown[];
}

/**
 * A database that answers from `tables`, keyed by table name, and records
 * every query it was asked. Rows are supplied as camelCase objects and
 * mapped onto the column order the generated SQL asked for, so the service
 * receives exactly what it would from MySQL - including a `null` for every
 * column a fixture does not mention.
 *
 * `ownLocation` covers the one query this stub cannot map honestly: the
 * `caregivers LEFT JOIN cities LEFT JOIN districts` that resolves a
 * caregiver's own location names. That query selects `cities.name_en` *and*
 * `districts.name_en`, and drizzle aliases them to distinct JavaScript keys
 * (`cityEn`, `districtEn`) that exist nowhere in the SQL text - so parsing the
 * generated SQL cannot tell the two apart, and a wrong guess would silently
 * return null for every joined field rather than fail. Its values are
 * therefore given positionally, against the select list in
 * `enrichCandidates`, and the column count is asserted on every call so that
 * a change to that query fails the test instead of misaligning the fixture.
 *
 * What is under test downstream is which column the service reads out of the
 * result, not how the join was evaluated.
 */
function stubDb(tables: Record<string, Row[]>, ownLocation: unknown[] = []) {
  const queries: QueryLog[] = [];

  const db = drizzle(
    async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      const columns = selectedColumns(sql);

      if (/left join/.test(sql)) {
        expect(columns).toHaveLength(OWN_LOCATION_SELECT.length);
        return { rows: ownLocation.length ? [ownLocation] : [] };
      }

      const table = /from `(\w+)`/.exec(sql)?.[1] ?? '';
      const rows = tables[table] ?? [];
      return {
        rows: rows.map((row) => columns.map((column) => valueFor(row, column) ?? null)),
      };
    },
    { schema, mode: 'default' } as never,
  ) as unknown as Database;

  return { db, queries };
}

/**
 * The select list of the own-location query in `enrichCandidates`, in order:
 * caregiverId, cityId, districtId, cityEn, citySi, cityTa, districtEn, districtSi,
 * districtTa. Used only to assert the fixture has not gone stale.
 */
const OWN_LOCATION_SELECT = [
  'id',
  'city_id',
  'district_id',
  'name_en',
  'name_si',
  'name_ta',
  'name_en',
  'name_si',
  'name_ta',
];

/** The queries that decide location membership, as (sql, params) pairs. */
function locationQueries(queries: QueryLog[]): QueryLog[] {
  return queries.filter(
    (q) => /`caregivers`\.`(city_id|district_id)` (in|=)/.test(q.sql) || (q.sql.includes('from `preferred_locations`') && q.sql.includes(' in ')),
  );
}

function serviceWith(db: Database) {
  return new PublicSearchService(db, new RankingService(), new GeoService(db));
}

/** Reference data every test can see. */
const REFERENCE = { cities: ALL_CITIES, districts: ALL_DISTRICTS };

const base: Partial<SearchRequestDto> = { page: 1, pageSize: 20 };

const ownQuery = (queries: QueryLog[]) => locationQueries(queries).find((q) => q.sql.includes('from `caregivers`'));
const preferredQuery = (queries: QueryLog[]) => locationQueries(queries).find((q) => q.sql.includes('from `preferred_locations`'));

describe('PublicSearchService location filtering', () => {
  it('matches caregivers living in any city within the radius, by id', async () => {
    const { db, queries } = stubDb(REFERENCE);
    await serviceWith(db).search({ ...base, location: { districtId: 1, cityId: 340 }, radiusKm: 10 } as SearchRequestDto);

    const own = ownQuery(queries);
    expect(own?.sql).toContain('`caregivers`.`city_id` in');
    // Dehiwala itself, Colombo and Moratuwa are inside 10 km; Gampaha and Galle are not.
    expect(own?.params).toEqual(expect.arrayContaining([340, 1, 654]));
    expect(own?.params).not.toContain(548);
    expect(own?.params).not.toContain(900);
    // Never by name.
    expect(own?.sql).not.toContain('`caregivers`.`city`');
    expect(own?.sql).not.toContain('`caregivers`.`district`');
  });

  it('widens with the radius', async () => {
    const { db, queries } = stubDb(REFERENCE);
    await serviceWith(db).search({ ...base, location: { districtId: 1, cityId: 340 }, radiusKm: 50 } as SearchRequestDto);
    expect(ownQuery(queries)?.params).toContain(548);
    expect(ownQuery(queries)?.params).not.toContain(900);
  });

  it('includes caregivers who travel to a city within the radius', async () => {
    const { db, queries } = stubDb(REFERENCE);
    await serviceWith(db).search({ ...base, location: { districtId: 1, cityId: 340 }, radiusKm: 10 } as SearchRequestDto);

    const preferred = preferredQuery(queries);
    expect(preferred?.sql).toContain('`preferred_locations`.`city_id` in');
    expect(preferred?.params).toEqual(expect.arrayContaining([340, 1, 654]));
    expect(preferred?.params).not.toContain(548);
  });

  it('places a caregiver with no city at their district centre', async () => {
    const { db, queries } = stubDb(REFERENCE);
    await serviceWith(db).search({ ...base, location: { districtId: 1, cityId: 340 }, radiusKm: 10 } as SearchRequestDto);
    const own = ownQuery(queries);
    expect(own?.sql).toContain('`caregivers`.`city_id` is null');
    expect(own?.sql).toContain('`caregivers`.`district_id` in');
  });

  it('keeps the whole searched district when there is no city to measure from', async () => {
    // A district-only search measures from the district's centre, but a big
    // district's far corner is still in the district the visitor asked for.
    const { db, queries } = stubDb(REFERENCE);
    await serviceWith(db).search({ ...base, location: { districtId: 1 }, radiusKm: 5 } as SearchRequestDto);
    expect(ownQuery(queries)?.sql).toContain('`caregivers`.`district_id` = ?');
    // Every city of the district counts for preferred work locations too.
    expect(preferredQuery(queries)?.params).toEqual(expect.arrayContaining([340, 1, 654]));
  });

  it('does not narrow by location at all when no location is given', async () => {
    // The distinction `search()` depends on: an absent filter must not become
    // an empty id set, which would return nobody instead of everybody.
    const { db, queries } = stubDb(REFERENCE);
    await serviceWith(db).search({ ...base } as SearchRequestDto);
    expect(locationQueries(queries)).toHaveLength(0);
    const pool = queries.find((q) => q.sql.includes('from `caregivers`') && q.sql.includes('limit'));
    expect(pool?.sql).not.toContain('1 = 0');
  });

  it('matches nobody for a location the reference data does not have', async () => {
    const { db, queries } = stubDb(REFERENCE);
    await serviceWith(db).search({ ...base, location: { districtId: 99 } } as SearchRequestDto);
    const pool = queries.find((q) => q.sql.includes('from `caregivers`') && q.sql.includes('limit'));
    expect(pool?.sql).toContain('1 = 0');
  });

  it('collapses to a never-matching predicate when the filter matched nobody', async () => {
    // `[]` and `null` both mean "no ids", but only `[]` means "no matches":
    // this is the branch that stops an empty area returning the country.
    const { db, queries } = stubDb({ ...REFERENCE, caregivers: [] });
    await serviceWith(db).search({ ...base, location: { districtId: 3 } } as SearchRequestDto);
    const pool = queries.find((q) => q.sql.includes('from `caregivers`') && q.sql.includes('limit'));
    expect(pool?.sql).toContain('1 = 0');
  });

  describe('choosing the origin', () => {
    const originOf = async (request: Partial<SearchRequestDto>) => {
      const { db } = stubDb(REFERENCE);
      return serviceWith(db).resolveOrigin({ ...base, ...request } as SearchRequestDto);
    };

    it("prefers the visitor's device location", async () => {
      const origin = await originOf({ location: { districtId: 1, cityId: 654 }, origin: { latitude: 6.86, longitude: 79.87 } });
      expect(origin).toMatchObject({ source: 'device', latitude: 6.86, longitude: 79.87, label: 'Dehiwala' });
    });

    it('ignores a device location nowhere near a known city', async () => {
      // London: a wrong reading, or a visitor abroad. Measuring from the
      // least-far Sri Lankan city would be a confident lie.
      const origin = await originOf({ location: { districtId: 1, cityId: 654 }, origin: { latitude: 51.5, longitude: -0.12 } });
      expect(origin).toMatchObject({ source: 'searchCity', label: 'Moratuwa' });
    });

    it('uses the searched city before the profile city', async () => {
      const origin = await originOf({ location: { districtId: 1, cityId: 654 }, origin: { cityId: 340 } });
      expect(origin).toMatchObject({ source: 'searchCity', label: 'Moratuwa' });
    });

    it('falls back to the profile city when no city was searched', async () => {
      const origin = await originOf({ location: { districtId: 1 }, origin: { cityId: 340 } });
      expect(origin).toMatchObject({ source: 'profileCity', label: 'Dehiwala', latitude: DEHIWALA.latitude });
    });

    it('does not use a profile city outside the searched district', async () => {
      // Searching Galle for a parent while living in Colombo: distances from
      // Colombo would be wrong for every result.
      const origin = await originOf({ location: { districtId: 3 }, origin: { cityId: 340 } });
      expect(origin).toMatchObject({ source: 'district', label: 'Galle', latitude: GALLE.latitude });
    });

    it('uses the default radius unless one is given', async () => {
      expect((await originOf({ location: { districtId: 1, cityId: 340 } }))?.radiusKm).toBe(25);
      expect((await originOf({ location: { districtId: 1, cityId: 340 }, radiusKm: 50 }))?.radiusKm).toBe(50);
    });

    it('has no origin without a location', async () => {
      expect(await originOf({})).toBeNull();
    });
  });

  describe('rendering', () => {
    const caregiverRow: Row = {
      id: 'cg-1',
      public_id: 'cg-1',
      gender: 'FEMALE',
      date_of_birth: new Date('1960-01-01'),
      district_id: 1,
      city_id: 340,
    };
    const tables = {
      ...REFERENCE,
      caregivers: [caregiverRow],
    };

    const searchIn = async (locale?: string, request: Partial<SearchRequestDto> = {}) => {
      const { db } = stubDb(tables, [
        'cg-1',
        340,
        1,
        'Dehiwala',
        'දෙහිවල',
        'தேவிவாலை',
        'Colombo',
        'කොළඹ',
        'கொழும்பு',
      ]);
      return serviceWith(db).search({
        ...base,
        location: { districtId: 1, cityId: 340 },
        locale,
        ...request,
      } as SearchRequestDto);
    };

    it('names the location in the requested language', async () => {
      const result = await searchIn('si');
      expect(result.items[0].district).toBe('කොළඹ');
      expect(result.items[0].city).toBe('දෙහිවල');
    });

    it('falls back to English for an unrecognised locale', async () => {
      // resolveLocale runs inside the service too, so a locale that never
      // passed the controller cannot select a column that does not exist.
      const result = await searchIn('fr');
      expect(result.items[0].district).toBe('Colombo');
      expect(result.items[0].city).toBe('Dehiwala');
    });

    it('carries the ids on the result so a client can re-submit them', async () => {
      const { items } = await searchIn();
      expect(items[0]).toMatchObject({ districtId: 1, cityId: 340 });
    });

    it('returns the same caregivers in every language', async () => {
      // The locale picks which column is read, nothing else. If it changed
      // membership or order, a search would silently depend on the visitor's
      // language.
      const ids = async (locale?: string) => (await searchIn(locale)).items.map((i) => i.publicId);
      expect(await ids('si')).toEqual(await ids('en'));
      expect(await ids('ta')).toEqual(await ids('en'));
    });

    it('places the caregiver at their city centre, never finer', async () => {
      const { items } = await searchIn();
      expect(items[0].homeLocation).toEqual({ latitude: DEHIWALA.latitude, longitude: DEHIWALA.longitude, precision: 'city' });
    });

    it('gives the straight-line distance from the origin in km, to one decimal', async () => {
      const fromMoratuwa = await searchIn('en', { location: { districtId: 1, cityId: 654 } });
      expect(fromMoratuwa.items[0].distanceKm).toBeCloseTo(8.9, 0);
      expect(Number.isInteger(fromMoratuwa.items[0].distanceKm! * 10)).toBe(true);
      expect(fromMoratuwa.items[0].reach).toBe('home');
    });

    it('describes the origin and the map points in the response', async () => {
      const result = await searchIn();
      expect(result.origin).toMatchObject({ source: 'searchCity', label: 'Dehiwala', radiusKm: 25 });
      expect(result.origin).not.toHaveProperty('districtId');
      expect(result.mapPoints).toEqual([
        { key: 'c340', name: 'Dehiwala', latitude: DEHIWALA.latitude, longitude: DEHIWALA.longitude, precision: 'city', distanceKm: 0, count: 1 },
      ]);
    });
  });
});
