import { caregiverRef, caregiverRefSearchPrefix } from '@care-platform/shared';
import { caregiverRefCondition, generateUniquePublicId } from './caregiver-ref.util';

const PUBLIC_ID = 'abcd1234-ef56-7890-abcd-1234567890ab';

describe('caregiverRefSearchPrefix', () => {
  it.each([
    ['abcd1234', 'abcd1234'],
    ['ABCD1234', 'abcd1234'],
    ['  abcd 1234 ', 'abcd1234'],
    ['ABCD-1234', 'abcd1234'],
    ['Caregiver abcd1234', 'abcd1234'],
    ['caregiver: #ABCD1234', 'abcd1234'],
    ['#abcd1234', 'abcd1234'],
    ['ID abcd1234', 'abcd1234'],
    ['සාත්තු සේවක abcd1234', 'abcd1234'],
    ['பராமரிப்பாளர் abcd1234', 'abcd1234'],
    ['abcd12', 'abcd12'],
    ['abcd1234ef56', 'abcd1234-ef56'],
    [PUBLIC_ID, PUBLIC_ID],
    [PUBLIC_ID.toUpperCase(), PUBLIC_ID],
    [`https://find.caregivers.lk/caregivers/${PUBLIC_ID}?from=search`, PUBLIC_ID],
  ])('reads %p as an ID prefix', (input, expected) => {
    expect(caregiverRefSearchPrefix(input)).toBe(expected);
  });

  it.each([[''], ['   '], ['abc'], ['Nimal Perera'], ['Dee'], ['CG-00012'], ['abcd123z'], [null], [undefined]])(
    'leaves %p to the normal search',
    (input) => {
      expect(caregiverRefSearchPrefix(input as string)).toBeNull();
    },
  );

  it('round-trips the ID shown to customers', () => {
    expect(caregiverRefSearchPrefix(`Caregiver ${caregiverRef(PUBLIC_ID)}`)).toBe(caregiverRef(PUBLIC_ID));
  });
});

describe('caregiverRefCondition', () => {
  it('adds a condition only for ID-like terms', () => {
    expect(caregiverRefCondition('Nimal')).toHaveLength(0);
    expect(caregiverRefCondition(undefined)).toHaveLength(0);
    expect(caregiverRefCondition('Caregiver ABCD1234')).toHaveLength(1);
  });
});

describe('generateUniquePublicId', () => {
  function fakeDb(takenResults: boolean[]) {
    const calls: number[] = [];
    let i = 0;
    const db = {
      select: () => ({
        from: () => ({
          where: () => ({
            limit: async () => {
              calls.push(i);
              return takenResults[i++] ? [{ n: 1 }] : [];
            },
          }),
        }),
      }),
    };
    return { db, calls };
  }

  it('returns a UUID when its short ID is free', async () => {
    const { db, calls } = fakeDb([false]);
    const id = await generateUniquePublicId(db);
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(calls).toHaveLength(1);
  });

  it('retries when the short ID is already taken', async () => {
    const { db, calls } = fakeDb([true, true, false]);
    await generateUniquePublicId(db);
    expect(calls).toHaveLength(3);
  });

  it('gives up after the allowed attempts', async () => {
    const { db } = fakeDb([true, true, true]);
    await expect(generateUniquePublicId(db, 3)).rejects.toThrow('unique caregiver public id');
  });
});
