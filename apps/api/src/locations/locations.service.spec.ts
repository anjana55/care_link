import { LocationsService } from './locations.service';
import { cities, districts, provinces } from '../database/schema';
import type { Database } from '../database/database.module';
import type { Locale } from '@care-platform/shared';

/**
 * Name resolution and the two shapes the browser actually receives.
 *
 * The stub routes by which table the query names, not by call order: findTree
 * issues its two queries concurrently through Promise.all, so completion order
 * is not source order and a queue would answer the wrong one.
 */
function stubDb(overrides: { provinces?: unknown[]; districts?: unknown[]; cities?: unknown[] } = {}) {
  // Each select() gets its own chain, and the rows are captured when from()
  // names the table. A single shared slot would not work: findTree's two
  // queries are built first and awaited together, so both would read whatever
  // the second from() left behind.
  const makeChain = (): Record<string, unknown> => {
    let rows: unknown[] | undefined;
    const chain: Record<string, unknown> = {
      select: () => makeChain(),
      from: (table: unknown) => {
        rows =
          table === provinces ? overrides.provinces : table === districts ? overrides.districts : overrides.cities;
        return chain;
      },
      where: () => chain,
      innerJoin: () => chain,
      orderBy: () => chain,
      limit: () => Promise.resolve([]),
      then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
        Promise.resolve(rows ?? []).then(resolve, reject),
    };
    return chain;
  };
  return { db: makeChain() as unknown as Database };
}

const WESTERN = { id: 1, nameEn: 'Western', nameSi: 'බරිනාගම', nameTa: 'බරිණගම' };
const CENTRAL = { id: 2, nameEn: 'Central', nameSi: 'මධ්‍යම', nameTa: 'மத்தி' };
const COLOMBO_DISTRICT = { id: 1, provinceId: 1, nameEn: 'Colombo', nameSi: 'කොළඹ', nameTa: 'கொழும்பு' };
const KANDY_DISTRICT = { id: 7, provinceId: 2, nameEn: 'Kandy', nameSi: 'මහනුවර', nameTa: 'மன்னார்' };

/** Two of the rows that make the string-typed choices in this schema non-negotiable. */
const DEHIWALA = {
  id: 340,
  districtId: 1,
  nameEn: 'Dehiwala',
  nameSi: 'දෙහිවල',
  nameTa: 'தேவிவாலை',
  // Wrapped in literal single quotes in the source CSV; the loader strips them.
  subNameEn: 'Modara',
  subNameSi: null,
  subNameTa: null,
  postcode: '10350',
  latitude: 6.84168,
  longitude: 79.86164,
};
/** One of the 47 postcodes that keep a leading zero, and one of the 16 rows
 *  with no postcode at all (this one has none). */
const COLOMBO_1 = {
  id: 1837,
  districtId: 1,
  nameEn: 'Colombo 1',
  nameSi: 'කොළඹ 1',
  nameTa: 'கொழும்பு 1',
  subNameEn: null,
  subNameSi: null,
  subNameTa: null,
  postcode: '00100',
  latitude: 6.91467,
  longitude: 79.84778,
};
const NO_POSTCODE = { ...COLOMBO_1, id: 2000, nameEn: 'Weliwita South', postcode: null };

describe('LocationsService', () => {
  describe('findTree', () => {
    // Two provinces with one district each, so grouping is actually exercised.
    const base = { provinces: [WESTERN, CENTRAL], districts: [COLOMBO_DISTRICT, KANDY_DISTRICT] };

    it('names provinces and districts in the requested language', async () => {
      const service = new LocationsService(stubDb(base).db);
      expect(await service.findTree('si')).toEqual([
        { id: 1, name: 'බරිනාගම', districts: [{ id: 1, name: 'කොළඹ' }] },
        { id: 2, name: 'මධ්‍යම', districts: [{ id: 7, name: 'මහනුවර' }] },
      ]);
    });

    it('names them in Tamil when Tamil is asked for', async () => {
      const service = new LocationsService(stubDb(base).db);
      const tree = await service.findTree('ta');
      expect(tree.map((p) => [p.name, p.districts.map((d) => d.name)])).toEqual([
        ['බරිණගම', ['கொழும்பு']],
        ['மத்தி', ['மன்னார்']],
      ]);
    });

    it('groups each district under its own province rather than listing them flat', async () => {
      const service = new LocationsService(stubDb(base).db);
      const tree = await service.findTree('en');
      expect(tree.map((p) => [p.name, p.districts.map((d) => d.id)])).toEqual([
        ['Western', [1]],
        ['Central', [7]],
      ]);
    });

    it('gives a province with no districts an empty list rather than undefined', async () => {
      const service = new LocationsService(
        stubDb({
          provinces: [WESTERN, { id: 9, nameEn: 'Northern', nameSi: 'උතුරු', nameTa: 'வடக்கு' }],
          districts: [COLOMBO_DISTRICT],
        }).db,
      );
      const tree = await service.findTree('en');
      expect(tree[1].districts).toEqual([]);
    });
  });

  describe('findCities', () => {
    it('returns the localized name, an unquoted sub-name and the postcode', async () => {
      const service = new LocationsService(stubDb({ cities: [DEHIWALA] }).db);
      expect(await service.findCities(1, 'si')).toEqual([
        {
          id: 340,
          name: 'දෙහිවල',
          // Falls back to the English sub-name because the source row has no
          // Sinhala one; a blank dropdown entry would be worse.
          subName: 'Modara',
          postcode: '10350',
          latitude: 6.84168,
          longitude: 79.86164,
        },
      ]);
    });

    it('keeps a leading-zero postcode as the string it is', async () => {
      // "00100" read as a number is 100, which is a postcode that does not
      // exist and would send the letter to the wrong part of the country.
      const service = new LocationsService(stubDb({ cities: [COLOMBO_1] }).db);
      const [city] = await service.findCities(1, 'en');
      expect(city.postcode).toBe('00100');
      expect(typeof city.postcode).toBe('string');
    });

    it('reports a missing postcode as null rather than an empty string', async () => {
      // 101 of the 2155 cities have none at all.
      const service = new LocationsService(stubDb({ cities: [NO_POSTCODE] }).db);
      const [city] = await service.findCities(1, 'en');
      expect(city.postcode).toBeNull();
    });

    it('does not leak the other two languages into the payload', async () => {
      // Only one name column crosses the wire: a third of the size, and no way
      // for a client to ask the API for a column that is not there.
      const service = new LocationsService(stubDb({ cities: [DEHIWALA] }).db);
      const [city] = (await service.findCities(1, 'en')) as unknown as Record<string, unknown>[];
      expect(Object.keys(city).sort()).toEqual(['id', 'latitude', 'longitude', 'name', 'postcode', 'subName']);
    });
  });

  describe('name fallback', () => {
    it('defaults to English for an unexpected locale', async () => {
      // resolveLocale happens in the controller; the service's own default
      // covers a caller that skips it.
      const service = new LocationsService(stubDb({ provinces: [WESTERN], districts: [COLOMBO_DISTRICT] }).db);
      const tree = await service.findTree('fr' as Locale);
      expect(tree[0].name).toBe('Western');
    });
  });
});