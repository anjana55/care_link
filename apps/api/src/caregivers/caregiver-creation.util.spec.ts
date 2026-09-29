import { BadRequestException } from '@nestjs/common';
import { Param, SQL } from 'drizzle-orm';
import { assertKnownLocationPair } from './caregiver-creation.util';
import type { Database } from '../database/database.module';

/**
 * The district/city guard. The city dropdown is derived from the selected
 * district, so a mismatched pair can only reach the API from a client bug or a
 * hand-rolled request - and a stored record whose city sits outside its
 * district can never be matched by the district-scoped public-search filters.
 *
 * The guard is a single lookup against the `locations` reference table, so the
 * stub below just has to answer that lookup correctly. It reads the district
 * and city back out of the Drizzle `and(eq, eq)` clause rather than being told
 * them, which is what lets these cases assert on what was actually looked up -
 * the trimming case especially, since "did it trim" is the whole point.
 */
const KNOWN = [
  { district: 'Colombo', city: 'Colombo' },
  { district: 'Colombo', city: 'Dehiwala' },
  { district: 'Gampaha', city: 'Negombo' },
];

function paramsOf(node: unknown): unknown[] {
  if (node instanceof Param) return [node.value];
  if (Array.isArray(node)) return node.flatMap(paramsOf);
  if (node instanceof SQL) return paramsOf(node.queryChunks);
  return [];
}

function stubDb(rows: { district: string; city: string }[] = KNOWN) {
  let looked: [string, string] | null = null;
  const chain = {
    select: () => chain,
    from: () => chain,
    where: (clause: unknown) => {
      const [district, city] = paramsOf(clause);
      looked = [district as string, city as string];
      return chain;
    },
    limit: () => Promise.resolve(rows.filter((r) => r.district === looked?.[0] && r.city === looked?.[1])),
  };
  return { db: chain as unknown as Database, lookedUp: () => looked };
}

describe('assertKnownLocationPair', () => {
  it('accepts a district/city pair present in the locations table', async () => {
    await expect(assertKnownLocationPair(stubDb().db, { district: 'Colombo', city: 'Dehiwala' })).resolves.toBeUndefined();
  });

  it('rejects a city that belongs to a different district', async () => {
    // Dehiwala is a Colombo city, so pairing it with Gampaha is the exact
    // mismatch the UI's derived city list is meant to make impossible.
    await expect(assertKnownLocationPair(stubDb().db, { district: 'Gampaha', city: 'Dehiwala' })).rejects.toBeInstanceOf(
      BadRequestException,
    );
  });

  it('rejects a district that is not in the locations table at all', async () => {
    await expect(assertKnownLocationPair(stubDb().db, { district: 'Nowhere', city: 'Nowhere' })).rejects.toThrow(
      /Unknown district\/city combination/,
    );
  });

  it('names the offending pair in the error so the caller can correct it', async () => {
    await expect(assertKnownLocationPair(stubDb().db, { district: 'Gampaha', city: 'Dehiwala' })).rejects.toThrow(
      "'Gampaha' / 'Dehiwala'",
    );
  });

  it('trims surrounding whitespace before matching', async () => {
    // A form field that round-tripped through a text input can arrive padded;
    // rejecting that would be a spurious failure, not a real mismatch.
    const { db, lookedUp } = stubDb();
    await expect(assertKnownLocationPair(db, { district: ' Colombo ', city: ' Dehiwala ' })).resolves.toBeUndefined();
    expect(lookedUp()).toEqual(['Colombo', 'Dehiwala']);
  });

  describe('partial pairs are exempt', () => {
    it.each([
      ['no city', { district: 'Colombo' }],
      ['no district', { city: 'Colombo' }],
      ['neither', {}],
      ['both null', { district: null, city: null }],
      ['both empty', { district: '', city: '' }],
      ['whitespace only', { district: '   ', city: '   ' }],
    ])('%s is skipped without querying the database', async (_label, fields) => {
      // A district with no city is still meaningful - the column is nullable -
      // so a half-filled pair must not be turned into a rejection.
      const { db, lookedUp } = stubDb();
      await expect(assertKnownLocationPair(db, fields)).resolves.toBeUndefined();
      expect(lookedUp()).toBeNull();
    });
  });
});
