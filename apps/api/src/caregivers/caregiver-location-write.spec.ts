import { CaregiversService } from './caregivers.service';
import { DRIZZLE } from '../database/database.module';
import { caregivers, cities, districts, provinces } from '../database/schema';
import type { Database } from '../database/database.module';

/**
 * The write path's contract about location: the ids go in, and everything
 * else about a location is derived.
 *
 * This is a closed set of behaviour rather than an open-ended "does it work"
 * test, because the alternative - trusting the client - produces records whose
 * display names disagree with the ids that public search and ranking actually
 * match on. Nothing downstream looks at `district`/`city`/`postalCode` when it
 * filters; they are read only for display, so a desynchronised row looks fine
 * in the staff UI and returns nothing in search.
 *
 * `update()` is exercised through a stubbed database rather than a real one:
 * what matters is the SET payload it builds, not the SQL that follows it.
 */
describe('CaregiversService location writes', () => {
  const DEHIWALA = {
    id: 340,
    districtId: 1,
    nameEn: 'Dehiwala',
    postcode: '10350',
  };
  const COLOMBO = { id: 1, nameEn: 'Colombo', provinceId: 1 };
  const WESTERN = { nameEn: 'Western' };

  /**
   * Routes by table rather than by call order: findOne() issues four selects
   * concurrently through Promise.all, and resolveLocationRefs issues three
   * more, so a queue would hand rows to the wrong query as soon as they
   * interleaved.
   */
  function stubDb(options: { city?: unknown[]; district?: unknown[]; province?: unknown[] } = {}) {
    const updates: Record<string, unknown>[] = [];
    const CAREGIVER = { id: 'cg-1', deletedAt: null };

    const makeChain = (): Record<string, unknown> => {
      let rows: unknown[] = [];
      const chain: Record<string, unknown> = {
        select: () => makeChain(),
        from: (table: unknown) => {
          if (table === caregivers) rows = [CAREGIVER];
          else if (table === cities) rows = options.city ?? [];
          else if (table === districts) rows = options.district ?? [];
          else if (table === provinces) rows = options.province ?? [];
          else rows = [];
          return chain;
        },
        where: () => chain,
        innerJoin: () => chain,
        leftJoin: () => chain,
        orderBy: () => chain,
        limit: () => Promise.resolve(rows),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(rows).then(resolve, reject),
      };
      return chain;
    };

    const db = new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (prop !== 'update') return () => makeChain();
          return (table: unknown) => {
            if (table !== caregivers) throw new Error(`unexpected table: ${String(table)}`);
            const c: Record<string, unknown> = {
              set: (values: Record<string, unknown>) => {
                updates.push(values);
                return c;
              },
              where: () => Promise.resolve([]),
            };
            return c;
          };
        },
      },
    ) as unknown as Database;

    return { db, updates };
  }

  function serviceWith(db: Database) {
    return new CaregiversService(db);
  }

  it('writes the display columns from the referenced rows, not from the request', async () => {
    const { db, updates } = stubDb({ city: [DEHIWALA], district: [COLOMBO], province: [WESTERN] });

    await serviceWith(db).update('cg-1', { fullName: 'Nimal Perera', districtId: 1, cityId: 340 });

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({
      fullName: 'Nimal Perera',
      districtId: 1,
      cityId: 340,
      district: 'Colombo',
      city: 'Dehiwala',
      postalCode: '10350',
    });
  });

  it('refuses to write the derived columns directly, whatever the client sends', async () => {
    // The DTO does not declare these, and whitelist validation strips them
    // before the service runs - but the service must not depend on that. A
    // second caller that reaches this method directly would otherwise be able
    // to set a display name that contradicts the id beside it.
    const { db, updates } = stubDb({ city: [DEHIWALA], district: [COLOMBO], province: [WESTERN] });

    await serviceWith(db).update('cg-1', {
      district: 'Jaffna',
      city: 'Jaffna',
      postalCode: '40000',
      districtId: 1,
      cityId: 340,
    } as never);

    expect(updates[0].district).toBe('Colombo');
    expect(updates[0].city).toBe('Dehiwala');
    expect(updates[0].postalCode).toBe('10350');
  });

  it('leaves the location alone on a partial update that does not mention it', async () => {
    // An admin fixing a phone number must not silently erase a caregiver's
    // city, which is what writing nulls unconditionally would do.
    const { db, updates } = stubDb();

    await serviceWith(db).update('cg-1', { secondaryPhone: '0771112222' });

    expect(updates[0]).toEqual({ secondaryPhone: '0771112222' });
    expect(updates[0]).not.toHaveProperty('districtId');
    expect(updates[0]).not.toHaveProperty('district');
  });

  it('issues no UPDATE at all when the form was left completely untouched', async () => {
    const { db, updates } = stubDb();

    await serviceWith(db).update('cg-1', {});

    expect(updates).toEqual([]);
  });

  it('clears the display columns when the city is removed but the district kept', async () => {
    // Half a location is legal: a caregiver who has said which district they
    // work in but not which city gets a district and no city.
    const { db, updates } = stubDb({ district: [COLOMBO] });

    await serviceWith(db).update('cg-1', { districtId: 1 });

    expect(updates[0]).toMatchObject({ districtId: 1, cityId: null, district: 'Colombo', city: null, postalCode: null });
  });

  it('infers the district from the city when only a city id is sent', async () => {
    const { db, updates } = stubDb({ city: [DEHIWALA], district: [COLOMBO], province: [WESTERN] });

    await serviceWith(db).update('cg-1', { cityId: 340 });

    expect(updates[0]).toMatchObject({ districtId: 1, cityId: 340, district: 'Colombo', city: 'Dehiwala' });
  });
});