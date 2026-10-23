import { UnprocessableEntityException } from '@nestjs/common';
import { haversineKm } from '@care-platform/shared';
import { GeoService } from './geo.service';
import { PublicGeoController } from './geo.controller';
import type { Database } from '../database/database.module';

const CITIES = [
  { id: 340, districtId: 1, nameEn: 'Dehiwala', nameSi: 'දෙහිවල', nameTa: 'தேவிவாலை', latitude: '6.85110000', longitude: '79.86590000' },
  { id: 654, districtId: 1, nameEn: 'Moratuwa', nameSi: 'මොරටුව', nameTa: 'மொரட்டுவை', latitude: '6.77300000', longitude: '79.88160000' },
  { id: 900, districtId: 3, nameEn: 'Galle', nameSi: 'ගාල්ල', nameTa: 'காலி', latitude: '6.05350000', longitude: '80.22100000' },
];
const DISTRICTS = [
  { id: 1, nameEn: 'Colombo', nameSi: 'කොළඹ', nameTa: 'கொழும்பு' },
  { id: 3, nameEn: 'Galle', nameSi: 'ගාල්ල', nameTa: 'காலி' },
];

/** Answers GeoService's two whole-table reads; counts them so caching can be checked. */
function fakeDb() {
  let reads = 0;
  const db = {
    select: (columns: Record<string, unknown>) => ({
      from: async () => {
        reads += 1;
        // The city read is the one that selects coordinates. MySQL decimals arrive as strings.
        return 'latitude' in columns ? CITIES : DISTRICTS;
      },
    }),
  } as unknown as Database;
  return { db, reads: () => reads };
}

describe('haversineKm', () => {
  it('measures a known distance (Colombo Fort to Kandy, ~96 km)', () => {
    expect(haversineKm({ latitude: 6.9344, longitude: 79.8428 }, { latitude: 7.2906, longitude: 80.6337 })).toBeCloseTo(95.8, 0);
  });

  it('is zero for the same point and symmetric', () => {
    const a = { latitude: 6.85, longitude: 79.86 };
    const b = { latitude: 6.05, longitude: 80.22 };
    expect(haversineKm(a, a)).toBe(0);
    expect(haversineKm(a, b)).toBeCloseTo(haversineKm(b, a), 10);
  });
});

describe('GeoService', () => {
  it('finds the nearest city and names it in the requested language', async () => {
    const geo = new GeoService(fakeDb().db);
    const nearest = await geo.nearestCity({ latitude: 6.84, longitude: 79.87 }, 'si');
    expect(nearest).toMatchObject({ cityId: 340, districtId: 1, name: 'දෙහිවල', districtName: 'කොළඹ' });
    expect(nearest!.distanceKm).toBeLessThan(2);
  });

  it('lists the cities within a radius', async () => {
    const geo = new GeoService(fakeDb().db);
    expect((await geo.cityIdsWithin({ latitude: 6.8511, longitude: 79.8659 }, 10)).sort()).toEqual([340, 654]);
    expect(await geo.cityIdsWithin({ latitude: 6.8511, longitude: 79.8659 }, 100)).toContain(900);
  });

  it("puts a district's centre at the mean of its cities", async () => {
    const geo = new GeoService(fakeDb().db);
    const colombo = await geo.district(1);
    expect(colombo?.latitude).toBeCloseTo((6.8511 + 6.773) / 2, 6);
    expect(colombo?.longitude).toBeCloseTo((79.8659 + 79.8816) / 2, 6);
  });

  it('reads the reference data once, not per question', async () => {
    const { db, reads } = fakeDb();
    const geo = new GeoService(db);
    await Promise.all([geo.city(340), geo.district(1), geo.cityIdsWithin({ latitude: 7, longitude: 80 }, 5)]);
    await geo.city(654);
    expect(reads()).toBe(2);
  });
});

describe('PublicGeoController', () => {
  it('refuses a point far from every known city rather than pretending it is near one', async () => {
    const controller = new PublicGeoController(new GeoService(fakeDb().db));
    await expect(controller.nearestCity({ latitude: 51.5, longitude: -0.12 })).rejects.toBeInstanceOf(UnprocessableEntityException);
  });

  it('answers with the nearest city for a point inside the covered area', async () => {
    const controller = new PublicGeoController(new GeoService(fakeDb().db));
    await expect(controller.nearestCity({ latitude: 6.06, longitude: 80.22, locale: 'ta' })).resolves.toMatchObject({ cityId: 900, name: 'காலி' });
  });
});
