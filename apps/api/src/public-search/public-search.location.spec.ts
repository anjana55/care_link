import { drizzle } from 'drizzle-orm/mysql-proxy';
import { PublicSearchService } from './public-search.service';
import { RankingService } from './ranking/ranking.service';
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

const DEHIWALA = {
  id: 340,
  districtId: 1,
  nameEn: 'Dehiwala',
  nameSi: 'දෙහිවල',
  nameTa: 'தேவிவாலை',
  postcode: '10350',
};
const COLOMBO_DISTRICT = {
  id: 1,
  provinceId: 1,
  nameEn: 'Colombo',
  nameSi: 'කොළඹ',
  nameTa: 'கொழும்பு',
};

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
 * caregiverId, cityId, cityEn, citySi, cityTa, districtEn, districtSi,
 * districtTa. Used only to assert the fixture has not gone stale.
 */
const OWN_LOCATION_SELECT = [
  'id',
  'city_id',
  'name_en',
  'name_si',
  'name_ta',
  'name_en',
  'name_si',
  'name_ta',
];

/** The queries that filter caregivers by location, as (sql, params) pairs. */
function locationQueries(queries: QueryLog[]): QueryLog[] {
  return queries.filter((q) => /`caregivers`\.`(city_id|district_id)`|from `preferred_locations`/.test(q.sql));
}

function serviceWith(db: Database) {
  return new PublicSearchService(db, new RankingService());
}

const base: Partial<SearchRequestDto> = { page: 1, pageSize: 20 };

describe('PublicSearchService location filtering', () => {
  it('filters on the city id column, never on a name', async () => {
    const { db, queries } = stubDb({});
    await serviceWith(db).search({ ...base, location: { cityId: 340 } } as SearchRequestDto);

    const sql = locationQueries(queries).map((q) => q.sql).join('\n');
    expect(sql).toContain('`caregivers`.`city_id` = ?');
    // The old implementation compared `city` and `district` text columns, so
    // this is the assertion that would have failed before the id migration.
    expect(sql).not.toContain('`caregivers`.`city`');
    expect(sql).not.toContain('`caregivers`.`district`');
  });

  it('binds the id that was requested', async () => {
    const { db, queries } = stubDb({});
    await serviceWith(db).search({ ...base, location: { cityId: 340, districtId: 1 } } as SearchRequestDto);

    const own = locationQueries(queries).find((q) => q.sql.includes('`caregivers`.`city_id`'));
    expect(own?.params).toEqual([340, 1]);
  });

  it('treats city and district as independent conditions, not as a pair', async () => {
    // The old code matched on the (district, city) pair together, so a city id
    // whose district column differed would silently match nothing. A city
    // filter is now exactly one predicate on one column.
    const { db, queries } = stubDb({});
    await serviceWith(db).search({ ...base, location: { cityId: 340 } } as SearchRequestDto);

    const own = locationQueries(queries).find((q) => q.sql.includes('`caregivers`.`city_id`'));
    expect(own?.sql).toContain('`caregivers`.`city_id` = ?');
    expect(own?.sql).not.toContain('`caregivers`.`district_id`');
  });

  it('includes preferred work locations, joined on the city id', async () => {
    const { db, queries } = stubDb({});
    await serviceWith(db).search({ ...base, location: { cityId: 340 } } as SearchRequestDto);

    const preferred = locationQueries(queries).find((q) => q.sql.includes('from `preferred_locations`'));
    expect(preferred).toBeDefined();
    expect(preferred?.sql).toContain('`preferred_locations`.`city_id` = ?');
    expect(preferred?.params).toContain(340);
  });

  it('does not query preferred locations for a district-only filter', async () => {
    // preferred_locations holds cities, not districts. There is no
    // preferred-district column to join on, so this second query would be a
    // full scan of the table returning every caregiver with any preference.
    const { db, queries } = stubDb({});
    await serviceWith(db).search({ ...base, location: { districtId: 1 } } as SearchRequestDto);

    expect(queries.some((q) => q.sql.includes('from `preferred_locations`') && q.sql.includes('where'))).toBe(false);
  });

  it('does not narrow by location at all when no location is given', async () => {
    // The distinction `search()` depends on: an absent filter must not become
    // an empty id set, which would return nobody instead of everybody.
    const { db, queries } = stubDb({});
    await serviceWith(db).search({ ...base } as SearchRequestDto);

    expect(queries.some((q) => q.sql.includes('`caregivers`.`city_id`') || q.sql.includes('`caregivers`.`district_id`'))).toBe(
      false,
    );
  });

  it('collapses to a never-matching predicate when the filter matched nobody', async () => {
    // `[]` and `null` both mean "no ids", but only `[]` means "no matches":
    // this is the branch that stops an empty district returning the country.
    const { db, queries } = stubDb({ caregivers: [] });
    await serviceWith(db).search({ ...base, location: { districtId: 25 } } as SearchRequestDto);

    const pool = queries.find((q) => q.sql.includes('from `caregivers`') && q.sql.includes('limit'));
    expect(pool?.sql).toContain('1 = 0');
  });

  it('does not collapse to a never-matching predicate when no location was asked for', async () => {
    const { db, queries } = stubDb({ caregivers: [] });
    await serviceWith(db).search({ ...base } as SearchRequestDto);

    const pool = queries.find((q) => q.sql.includes('from `caregivers`') && q.sql.includes('limit'));
    expect(pool?.sql).not.toContain('1 = 0');
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
      caregivers: [caregiverRow],
      cities: [DEHIWALA],
      districts: [COLOMBO_DISTRICT],
    };

    const searchIn = async (locale?: string) => {
      const { db } = stubDb(tables, [
        'cg-1',
        340,
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
  });
});