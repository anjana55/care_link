import { ConflictException } from '@nestjs/common';
import { and, eq, inArray, ne } from 'drizzle-orm';
import type { SQL } from 'drizzle-orm';
import { assertWhatsappNumberAvailable } from './phone-accounts.util';
import type { Database } from '../database/database.module';
import { caregivers, patients, users } from '../database/schema';

/**
 * The three-table collision check, and above all its exclusion rules.
 *
 * The exclusions are what this is really about. On an edit (PATCH /patients/:id)
 * the row being written matches itself on the `users` lookup (always) and on the
 * `patients` lookup (whenever the stored spelling is a variant of the number
 * being written - which is always, because we write the text as typed). Without
 * the exclusions, every re-save of a client's own number would 409, which is
 * exactly what the inline edit form does on every save.
 *
 * The stub answers each lookup from a fixed result set and records the WHERE
 * argument it was handed, so the exclusion tests assert on the real predicate
 * rather than on an empty result set - which would pass even if the exclusion
 * had been dropped entirely.
 */
const CC = '94';
const E164 = '+94771234567';

const LOGIN = { id: 'u1', phone: E164 };
const PROFILE = { id: 'p1', phone: '0771234567' };

/** Renders a predicate the way the driver would, so assertions can be made on
 * the clause that was actually built rather than on its object identity.
 * Recurses, because `and()` nests its operands as objects. */
function render(node: unknown): string {
  if (node === null || node === undefined) return '';
  if (typeof node !== 'object') return String(node);

  const chunks = (node as { queryChunks?: unknown[] }).queryChunks;
  // A bound parameter: StringValue carries the value it will be substituted with.
  if (!chunks && 'value' in (node as Record<string, unknown>)) {
    return `'${String((node as { value: unknown }).value)}'`;
  }
  if (!chunks) return '';

  return chunks
    .map((chunk) => {
      // `and(...)` wraps its operands in Parens, which shows up as nested SQL.
      if (chunk && typeof chunk === 'object' && 'queryChunks' in (chunk as Record<string, unknown>)) {
        return `(${render(chunk)})`;
      }
      if (Array.isArray(chunk)) return chunk.map(render).join(' ');
      return render(chunk);
    })
    .join(' ')
    .replace(/\s+/g, ' ');
}

function stubDb(answers: { user?: unknown[]; caregiver?: unknown[]; patient?: unknown[] } = {}) {
  const whereArgs: (SQL | undefined)[] = [];
  let call = 0;
  const queue = [answers.user ?? [], answers.caregiver ?? [], answers.patient ?? []];
  const chain = {
    select: () => chain,
    from: () => chain,
    where: (w?: SQL) => {
      whereArgs.push(w);
      return { limit: () => Promise.resolve(queue[call++] ?? []) };
    },
  };
  return { db: chain as unknown as Database, whereArgs };
}

describe('assertWhatsappNumberAvailable', () => {
  it('accepts a number that belongs to nobody', async () => {
    const { db } = stubDb();
    await expect(assertWhatsappNumberAvailable(db, E164, CC)).resolves.toBeUndefined();
  });

  it('rejects a number already claimed as a WhatsApp login', async () => {
    const { db } = stubDb({ user: [{ id: 'u1' }] });
    await expect(assertWhatsappNumberAvailable(db, E164, CC)).rejects.toThrow(/WhatsApp number already exists/);
  });

  it('rejects a number already on a caregiver profile', async () => {
    const { db } = stubDb({ caregiver: [{ id: 'c1' }] });
    await expect(assertWhatsappNumberAvailable(db, E164, CC)).rejects.toThrow(/phone number already exists/);
  });

  it('rejects a number already on another client profile', async () => {
    const { db } = stubDb({ patient: [{ id: 'p1' }] });
    await expect(assertWhatsappNumberAvailable(db, E164, CC)).rejects.toThrow(/phone number already exists/);
  });

  it('stops after the first table that matches', async () => {
    const { db, whereArgs } = stubDb({ user: [{ id: 'u1' }] });
    await expect(assertWhatsappNumberAvailable(db, E164, CC)).rejects.toThrow(ConflictException);
    expect(whereArgs).toHaveLength(1);
  });

  describe('exclusions - the edit case', () => {
    it('ignores the login being edited', async () => {
      // The same lookup that rejects above is narrowed by ne(users.id, ...).
      const { db, whereArgs } = stubDb({ user: [] });
      await expect(
        assertWhatsappNumberAvailable(db, E164, CC, { userId: LOGIN.id, patientId: PROFILE.id }),
      ).resolves.toBeUndefined();

      const usersLookup = render(whereArgs[0]);
      expect(usersLookup).toContain('<>');   // Drizzle's SQL for ne()
      expect(usersLookup).toContain(LOGIN.id);
      // The equality on the number is still there - this narrows, not replaces.
      expect(usersLookup).toContain(`=`);
      expect(usersLookup).toContain(E164);
    });

    it('ignores the client profile being edited', async () => {
      const { db, whereArgs } = stubDb({ patient: [] });
      await expect(
        assertWhatsappNumberAvailable(db, E164, CC, { userId: LOGIN.id, patientId: PROFILE.id }),
      ).resolves.toBeUndefined();

      // Third lookup: users, then caregivers, then patients.
      const patientsLookup = render(whereArgs[2]);
      expect(patientsLookup).toContain(PROFILE.id);
    });

    it('never narrows the caregivers lookup', async () => {
      // A PATIENT_GUARDIAN login has no caregivers row, so a hit there is always
      // a genuine collision rather than the row being edited.
      const { db, whereArgs } = stubDb({ caregiver: [] });
      await expect(
        assertWhatsappNumberAvailable(db, E164, CC, { userId: LOGIN.id, patientId: PROFILE.id }),
      ).resolves.toBeUndefined();

      expect(render(whereArgs[1])).not.toContain('<>');
    });

    it('leaves every lookup unnarrowed when no exclusion is passed', async () => {
      // The two existing call sites pass three arguments; the default must
      // reproduce today's behaviour exactly.
      const { db, whereArgs } = stubDb();
      await assertWhatsappNumberAvailable(db, E164, CC);

      for (const where of whereArgs) {
        expect(render(where)).not.toContain('<>');
      }
    });
  });
});

describe('the predicates the exclusions are built from', () => {
  it('adds a ne() clause only when an id is supplied', () => {
    expect(render(and(eq(users.phone, E164), ne(users.id, 'u1')))).toContain('<>');
    expect(render(eq(users.phone, E164))).not.toContain('<>');
  });

  it('keeps the inArray() variant check on the free-text phone columns', () => {
    // Free-text columns hold any spelling, so all variants must be matched -
    // this is what lets a respelling collide with the row it came from.
    expect(render(inArray(patients.phone, [E164, '0771234567']))).toContain('in');
  });

  it('excludes on the caregivers column only through the same free-text path', () => {
    expect(render(inArray(caregivers.primaryPhone, [E164]))).toContain('in');
  });
});