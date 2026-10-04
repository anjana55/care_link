import { BadRequestException } from '@nestjs/common';
import { resolveLocationRefs } from './location.util';
import type { Database } from '../../database/database.module';

/**
 * The district/city guard, now over ids rather than typed names.
 *
 * The city dropdown is derived from the selected district, so a mismatched pair
 * can only reach the API from a client bug or a hand-rolled request - and a
 * stored record whose city sits outside its district can never be matched by the
 * district-scoped public-search filters.
 *
 * Name matching made this weaker than it looked: the old guard compared two
 * free-text strings, and ten of the real city names appear under more than one
 * district. Comparing ids removes that ambiguity entirely.
 *
 * The stub below answers the three lookups in order (city, district, province)
 * rather than parsing them out of the query, because what these cases are
 * really asserting is the decision the function makes, not the SQL it emits.
 */
const COLOMBO = { id: 1, nameEn: 'Colombo', nameSi: 'කොළඹ', nameTa: 'கொழும்பு' };
const DEHIWALA = { id: 340, districtId: 1, nameEn: 'Dehiwala', postcode: '10350' };

function stubDb(overrides: {
  city?: unknown[] | null;
  district?: unknown[] | null;
  province?: unknown[] | null;
} = {}) {
  let call = 0;
  const chain = {
    select: () => chain,
    from: () => chain,
    where: () => chain,
    innerJoin: () => chain,
    limit: () => {
      const answer = [overrides.city, overrides.district, overrides.province][call++];
      return Promise.resolve(answer === undefined ? [] : answer);
    },
  };
  return { db: chain as unknown as Database };
}

describe('resolveLocationRefs', () => {
  it('derives the display columns and postcode from the referenced rows', async () => {
    const { db } = stubDb({ city: [DEHIWALA], district: [COLOMBO], province: [{ nameEn: 'Western' }] });
    await expect(resolveLocationRefs(db, { districtId: 1, cityId: 340 })).resolves.toEqual({
      districtId: 1,
      cityId: 340,
      district: 'Colombo',
      city: 'Dehiwala',
      province: 'Western',
      // From the city record, not from the client - which is the whole point
      // of dropping the field off the form.
      postalCode: '10350',
    });
  });

  it('rejects a city that belongs to a different district', async () => {
    // Dehiwala is a Colombo city, so pairing it with Gampaha is the exact
    // mismatch the UI's derived city list is meant to make impossible.
    // A fresh stub per assertion: the stub answers its three lookups in order,
    // so reusing one across two calls would run the second off the end.
    await expect(
      resolveLocationRefs(stubDb({ city: [DEHIWALA] }).db, { districtId: 2, cityId: 340 }),
    ).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      resolveLocationRefs(stubDb({ city: [DEHIWALA] }).db, { districtId: 2, cityId: 340 }),
    ).rejects.toThrow('City 340 belongs to district 1, not district 2');
  });

  it('rejects a city id that does not exist at all', async () => {
    const { db } = stubDb({ city: [] });
    await expect(resolveLocationRefs(db, { cityId: 999999 })).rejects.toThrow(/Unknown city id/);
  });

  it('rejects a district id that does not exist at all', async () => {
    const { db } = stubDb({ district: [] });
    await expect(resolveLocationRefs(db, { districtId: 999999 })).rejects.toThrow(/Unknown district id/);
  });

  it('infers the district from the city when only a city is given', async () => {
    const { db } = stubDb({ city: [DEHIWALA], district: [COLOMBO] });
    const resolved = await resolveLocationRefs(db, { cityId: 340 });
    expect(resolved).toMatchObject({ districtId: COLOMBO.id, cityId: 340, district: 'Colombo' });
  });

  it('leaves the postcode null for a city that has none', async () => {
    // 101 of the 2155 cities in the source data have no postcode at all.
    const { db } = stubDb({ city: [{ ...DEHIWALA, postcode: null }], district: [COLOMBO] });
    await expect(resolveLocationRefs(db, { cityId: 340 })).resolves.toMatchObject({ postalCode: null });
  });

  it('returns null when neither id is supplied, so an untouched form is a no-op', async () => {
    // A partial update that does not touch the location must leave the
    // existing one alone rather than erasing it.
    await expect(resolveLocationRefs(stubDb().db, {})).resolves.toBeNull();
    await expect(resolveLocationRefs(stubDb().db, { districtId: null, cityId: null })).resolves.toBeNull();
  });
});
