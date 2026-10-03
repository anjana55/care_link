import { Inject, Injectable } from '@nestjs/common';
import { asc, eq, sql } from 'drizzle-orm';
import type { Locale, PublicLocationTree, PublicMetaCity } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { cities, districts, provinces } from '../database/schema';

/**
 * The province/district/city reference data, loaded from CSV by
 * database/scripts/load-location-csv.ts.
 *
 * Read paths take a locale and pick the matching name column server-side. Doing
 * it here rather than sending all three names to the browser matters twice
 * over: the payload stays a third of the size, and a client cannot ask for a
 * column that does not exist.
 */
@Injectable()
export class LocationsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /**
   * Province -> district, no cities. 34 rows for the whole country, so the
   * client caches it for the session and a district dropdown costs one
   * request. Cities are fetched per district, because all 2155 of them is
   * roughly a quarter of a megabyte and a visitor only ever needs one
   * district's worth at a time.
   */
  async findTree(locale: Locale): Promise<PublicLocationTree> {
    const [provinceRows, districtRows] = await Promise.all([
      this.db.select().from(provinces).orderBy(asc(provinces.id)),
      this.db.select().from(districts).orderBy(asc(districts.id)),
    ]);

    const byProvince = new Map<number, { id: number; name: string }[]>();
    for (const district of districtRows) {
      byProvince.set(district.provinceId, [
        ...(byProvince.get(district.provinceId) ?? []),
        { id: district.id, name: nameFor(district, locale) },
      ]);
    }

    return provinceRows.map((province) => ({
      id: province.id,
      name: nameFor(province, locale),
      districts: byProvince.get(province.id) ?? [],
    }));
  }

  /** One district's cities, named in `locale`. */
  async findCities(districtId: number, locale: Locale): Promise<PublicMetaCity[]> {
    const rows = await this.db.select().from(cities).where(eq(cities.districtId, districtId)).orderBy(asc(cities.id));
    return rows.map((row) => ({
      id: row.id,
      name: nameFor(row, locale),
      subName: subNameFor(row, locale),
      postcode: row.postcode,
      latitude: row.latitude,
      longitude: row.longitude,
    }));
  }

  /**
   * Paginated city list for the read-only staff browser. Same shape as
   * findCities plus the two parent names, so the page can show which district
   * a result belongs to without a second request per row.
   */
  async findCitiesPage(opts: {
    districtId?: number;
    page: number;
    pageSize: number;
    query?: string;
    locale?: Locale;
  }) {
    const locale = opts.locale ?? 'en';
    // Sub-names and postcodes are searched too, because the browse box offers
    // them: a staff member looking up "Modara" or "10350" expects a hit, and a
    // search that silently ignores what it appears to match is worse than none.
    const where = opts.query
      ? sql`(${cities.nameEn} LIKE ${`%${opts.query}%`} OR ${cities.nameSi} LIKE ${`%${opts.query}%`} OR ${cities.nameTa} LIKE ${`%${opts.query}%`} OR ${cities.subNameEn} LIKE ${`%${opts.query}%`} OR ${cities.subNameSi} LIKE ${`%${opts.query}%`} OR ${cities.subNameTa} LIKE ${`%${opts.query}%`} OR ${cities.postcode} LIKE ${`%${opts.query}%`})`
      : undefined;
    const filters = [
      opts.districtId ? eq(cities.districtId, opts.districtId) : undefined,
      where,
    ].filter((c): c is NonNullable<typeof c> => c !== undefined);

    // All three name columns are selected even though one is returned: the
    // locale is resolved after the query so the same projection serves every
    // language, exactly as findTree/findCities do.
    const rows = await this.db
      .select({
        id: cities.id,
        nameEn: cities.nameEn,
        nameSi: cities.nameSi,
        nameTa: cities.nameTa,
        subNameEn: cities.subNameEn,
        subNameSi: cities.subNameSi,
        subNameTa: cities.subNameTa,
        postcode: cities.postcode,
        latitude: cities.latitude,
        longitude: cities.longitude,
        districtId: cities.districtId,
        districtNameEn: districts.nameEn,
        districtNameSi: districts.nameSi,
        districtNameTa: districts.nameTa,
        provinceNameEn: provinces.nameEn,
      })
      .from(cities)
      .innerJoin(districts, eq(cities.districtId, districts.id))
      .innerJoin(provinces, eq(districts.provinceId, provinces.id))
      .where(filters.length ? sql.join(filters, sql` AND `) : undefined)
      .orderBy(asc(cities.id))
      .limit(opts.pageSize)
      .offset((opts.page - 1) * opts.pageSize);

    const [{ total }] = await this.db
      .select({ total: sql<number>`count(*)` })
      .from(cities)
      .innerJoin(districts, eq(cities.districtId, districts.id))
      .innerJoin(provinces, eq(districts.provinceId, provinces.id))
      .where(filters.length ? sql.join(filters, sql` AND `) : undefined);

    return {
      items: rows.map((row) => ({
        id: row.id,
        name: nameFor(row, locale),
        subName: subNameFor(row, locale),
        postcode: row.postcode,
        latitude: row.latitude,
        longitude: row.longitude,
        districtId: row.districtId,
        district: nameFor(
          { nameEn: row.districtNameEn, nameSi: row.districtNameSi, nameTa: row.districtNameTa },
          locale,
        ),
        province: row.provinceNameEn,
      })),
      page: opts.page,
      pageSize: opts.pageSize,
      total: Number(total),
      totalPages: Math.ceil(Number(total) / opts.pageSize),
    };
  }
}

/**
 * Picks the name column for a locale, falling back to English. The fallback
 * is not hypothetical: the source CSVs have a row with a sub-name in English
 * and none in Sinhala, and a missing translation should degrade to something
 * readable rather than to a blank dropdown entry.
 */
function nameFor(row: { nameEn: string; nameSi: string; nameTa: string }, locale: Locale): string {
  return locale === 'si' ? row.nameSi : locale === 'ta' ? row.nameTa : row.nameEn;
}

function subNameFor(
  row: { subNameEn: string | null; subNameSi: string | null; subNameTa: string | null },
  locale: Locale,
): string | null {
  const value = locale === 'si' ? row.subNameSi : locale === 'ta' ? row.subNameTa : row.subNameEn;
  return value ?? row.subNameEn;
}
