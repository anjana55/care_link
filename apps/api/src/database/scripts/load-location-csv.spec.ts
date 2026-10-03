import { drizzle } from 'drizzle-orm/mysql-proxy';
import * as schema from '../schema';
import type { Database } from '../database.module';
import { loadLocationCsvs, parseLocationCsvs } from './load-location-csv';

/**
 * The location loader's orphan sweep, driven through the real Drizzle query
 * builder.
 *
 * `mysql-proxy` is Drizzle's own driver, so the loader builds genuine SQL
 * against the genuine schema and only the database's answer is faked. That is
 * the point: the bug this pins was semantic, not a crash. The sweep deletes
 * each table's rows the CSVs no longer mention, comparing against an id list
 * supplied by the caller - and the district delete was being handed the
 * *province* ids. Provinces are 1-9 and districts 1-25, so the statement read
 * `delete from districts where id NOT IN (1,...,9)` and MySQL refused with
 * ER_ROW_IS_REFERENCED_2, because districts 10-25 all have cities. The
 * production seed aborted on it.
 *
 * A hand-written stub would have passed throughout: it never evaluates a WHERE
 * clause, so it cannot tell a correct id list from a wrong one. The generated
 * SQL and its bound parameters can, and they are what these assertions read.
 */

interface CapturedQuery {
  sql: string;
  params: unknown[];
}

/** The rows of the `delete from <table>` statement at `index` of `queries`. */
function deleteStatement(queries: CapturedQuery[], table: string): CapturedQuery {
  const match = queries.find((q) => new RegExp(`delete from \`${table}\``, 'i').test(q.sql));
  if (!match) throw new Error(`no delete against \`${table}\` was issued. Issued: ${queries.map((q) => q.sql).join(' | ')}`);
  return match;
}

function recordingDb() {
  const queries: CapturedQuery[] = [];
  const db = drizzle(
    async (sql: string, params: unknown[]) => {
      queries.push({ sql, params });
      // The driver reads insertId/affectedRows off the first row for any
      // statement without a field list, so an insert that returned a bare
      // empty array made it dereference undefined. Nothing here needs real
      // results - only the SQL and its bound parameters are asserted.
      return { rows: [{ insertId: 0, affectedRows: 0 }] };
    },
    { schema, mode: 'default' } as never,
  ) as unknown as Database;
  return { db, queries };
}

/**
 * The real shape of the shipped data, which is what makes the bug possible:
 * three overlapping id spaces that only look alike.
 */
describe('the location CSVs', () => {
  const parsed = parseLocationCsvs();

  it('uses different id ranges per table, so a mixed-up list is silently wrong', () => {
    const provinceIds = parsed.provinces.map((p) => p.id);
    const districtIds = parsed.districts.map((d) => d.id);

    expect(provinceIds).toHaveLength(9);
    expect(districtIds).toHaveLength(25);

    // The province ids are a strict prefix of the district ids - which is
    // exactly why substituting one for the other produced a statement that
    // parsed, type-checked, and looked right. Only the row counts differed.
    expect(Math.max(...provinceIds)).toBeLessThan(Math.max(...districtIds));
    expect(districtIds).toEqual(expect.arrayContaining(provinceIds));
  });

  it('gives every city a district that the districts file defines', () => {
    const districtIds = new Set(parsed.districts.map((d) => d.id));
    for (const city of parsed.cities) {
      expect(districtIds.has(city.districtId)).toBe(true);
    }
  });
});

describe('loadLocationCsvs orphan sweep', () => {
  it('deletes each table against its own id list', async () => {
    const { db, queries } = recordingDb();
    await loadLocationCsvs(db);

    const { districts, provinces, cities } = parseLocationCsvs();

    // The regression: this one used the province ids.
    expect(deleteStatement(queries, 'districts').params).toEqual(districts.map((d) => d.id));
    expect(deleteStatement(queries, 'provinces').params).toEqual(provinces.map((p) => p.id));
    expect(deleteStatement(queries, 'cities').params).toEqual(districts.map((d) => d.id));
  });

  it('never asks a district delete to keep only the province ids', async () => {
    const { db, queries } = recordingDb();
    await loadLocationCsvs(db);

    const provinceIds = parseLocationCsvs().provinces.map((p) => p.id);
    const districtDelete = deleteStatement(queries, 'districts');

    // Guards the failure mode directly: had this regressed, the statement
    // would keep 1-9 and try to remove districts 10-25, every one of which
    // has cities.
    expect(districtDelete.params).not.toEqual(provinceIds);
    expect(districtDelete.params).toHaveLength(25);
  });

  it('deletes children before parents, so no delete orphans a live reference', async () => {
    const { db, queries } = recordingDb();
    await loadLocationCsvs(db);

    const order = queries
      .map((q, i) => (/delete from `(\w+)`/.exec(q.sql)?.[1] ?? null) && ({ table: /delete from `(\w+)`/.exec(q.sql)![1], i }))
      .filter((entry): entry is { table: string; i: number } => entry !== null);

    const firstCities = order.findIndex((e) => e.table === 'cities');
    const firstDistricts = order.findIndex((e) => e.table === 'districts');
    const firstProvinces = order.findIndex((e) => e.table === 'provinces');

    expect(firstCities).toBeGreaterThanOrEqual(0);
    // A district cannot be removed while a city points at it, and a province
    // cannot be removed while a district does. MySQL enforces this (1451), and
    // the failure aborted a production seed.
    expect(firstCities).toBeLessThan(firstDistricts);
    expect(firstDistricts).toBeLessThan(firstProvinces);
  });

  it('reports what it loaded', async () => {
    const { db } = recordingDb();
    await expect(loadLocationCsvs(db)).resolves.toEqual({ provinces: 9, districts: 25, cities: 2155 });
  });
});