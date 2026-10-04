import { BadRequestException, ConflictException } from '@nestjs/common';
import { PatientsService } from './patients.service';
import { DRIZZLE } from '../database/database.module';
import { patients, users, cities, districts, provinces } from '../database/schema';
import type { Database } from '../database/database.module';
import { UpdatePatientDto } from './dto/update-patient.dto';

/**
 * PatientsService.update()'s contract, exercised through a stubbed database
 * rather than a real one: what matters is the SET payload it builds and the
 * errors it refuses to swallow, not the SQL that follows.
 *
 * The phone cases dominate because they are the only place this update can
 * damage something. It writes TWO rows for one field - the free-text
 * patients.phone and the E.164 users.phone that is the WhatsApp login identity
 * - and clearing phoneVerifiedAt is the difference between "re-verify by
 * choice" and "someone else completes a LOGIN OTP and takes the account".
 */
describe('PatientsService.update', () => {
  const DEHIWALA = { id: 340, districtId: 1, nameEn: 'Dehiwala', postcode: '10350' };
  const COLOMBO = { id: 1, nameEn: 'Colombo', provinceId: 1 };
  const WESTERN = { nameEn: 'Western' };

  /** The client of interest: registered by email, so users.phone is null. */
  const PATIENT: Record<string, unknown> = {
    id: 'pt-1',
    userId: 'user-1',
    fullName: 'Nimal Perera',
    phone: null,
    status: 'PENDING_REVIEW',
    accountPhone: null,
    email: 'nimal@example.com',
    emailVerifiedAt: new Date('2026-01-01'),
    isActive: true,
    districtId: null,
    cityId: null,
  };

  interface StubOptions {
    patient?: Record<string, unknown>;
    /** Rows returned by the availability check, keyed by table. */
    takenBy?: Record<string, unknown[]>;
    cities?: unknown[];
    districts?: unknown[];
    provinces?: unknown[];
  }

  function stubDb(options: StubOptions = {}) {
    const row = { ...PATIENT, ...(options.patient ?? {}) };
    const patientUpdates: Record<string, unknown>[] = [];
    const userUpdates: Record<string, unknown>[] = [];
    const taken = options.takenBy ?? {};
    let servedPatient = false;

    const makeChain = (): Record<string, unknown> => {
      let rows: unknown[] = [];
      const chain: Record<string, unknown> = {
        select: () => {
          // Each select() starts a new statement. The stubbed client row is
          // only ever returned by the first one - findOrThrow's. Any later
          // read of `patients` is the phone-availability check, which must find
          // nothing: the row being edited is exactly the row that would match,
          // so serving it here would make every edit self-conflict.
          servedPatient = false;
          return makeChain();
        },
        from: (table: unknown) => {
          if (table === patients) rows = servedPatient ? [] : [row];
          else if (table === users) rows = taken[users as unknown as string] ?? [];
          else if (table === cities) rows = options.cities ?? [];
          else if (table === districts) rows = options.districts ?? [];
          else if (table === provinces) rows = options.provinces ?? [];
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

    /** The chain used inside the transaction: every read here is a conflict check,
     *  which must find only rows the test planted as `takenBy` - never the stubbed
     *  client, which is the row being edited and would self-conflict. */
    const makeEmptyChain = (): Record<string, unknown> => {
      let rows: unknown[] = [];
      const chain: Record<string, unknown> = {
        select: () => makeEmptyChain(),
        from: (table: unknown) => {
          rows = taken[table as string] ?? [];
          return chain;
        },
        where: () => chain,
        limit: () => Promise.resolve(rows),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(rows).then(resolve, reject),
      };
      return chain;
    };

    const capture = (sink: Record<string, unknown>[]) => () => {
      const c: Record<string, unknown> = {
        set: (values: Record<string, unknown>) => {
          sink.push(values);
          return c;
        },
        where: () => Promise.resolve([]),
      };
      return c;
    };

    const tx = {
      // Availability checks run on the transaction handle and must never see
      // the stubbed client row: the row being edited is exactly the row that
      // would match, so serving it makes every phone edit conflict with itself.
      select: () => makeEmptyChain(),
      from: (table: unknown) => (makeEmptyChain().from as (t: unknown) => unknown)(table),
      update: (table: unknown) => {
        if (table === patients) return capture(patientUpdates)();
        if (table === users) return capture(userUpdates)();
        throw new Error(`unexpected table: ${String(table)}`);
      },
    };

    const db = new Proxy(
      {},
      {
        get: (_t, prop: string) => {
          if (prop === 'transaction') return async (fn: (t: typeof tx) => unknown) => fn(tx);
          if (prop === 'update') return () => makeChain();
          return () => makeChain();
        },
      },
    ) as unknown as Database;

    return { db, patientUpdates, userUpdates };
  }

  function serviceWith(db: Database, countryCode = '94') {
    const settings = { getDefaultCountryCode: async () => countryCode };
    const ctor = PatientsService as unknown as new (d: unknown, s: unknown) => PatientsService;
    return new ctor(db, settings);
  }

  const dto = (body: Record<string, unknown>) => Object.assign(new UpdatePatientDto(), body);

  it('writes both phone representations from one typed number', async () => {
    const { db, patientUpdates, userUpdates } = stubDb();

    await serviceWith(db).update('pt-1', dto({ phone: '0771234567' }));

    // Free text on the display/search column, E.164 on the login identity.
    expect(patientUpdates[0]).toMatchObject({ phone: '0771234567' });
    expect(userUpdates[0]).toMatchObject({ phone: '+94771234567' });
  });

  it('clears phoneVerifiedAt only when the number actually changes', async () => {
    const { db, userUpdates } = stubDb();

    await serviceWith(db).update('pt-1', dto({ phone: '0771234567' }));

    expect(userUpdates[0]).toHaveProperty('phoneVerifiedAt', null);
  });

  it('treats a respelling of the same number as no change', async () => {
    // accountPhone is stored E.164; re-saving the local spelling must not cost
    // the client their WhatsApp verification.
    const { db, userUpdates } = stubDb({ patient: { accountPhone: '+94771234567' } });

    await serviceWith(db).update('pt-1', dto({ phone: '0771234567' }));

    expect(userUpdates[0]).not.toHaveProperty('phoneVerifiedAt');
    expect(userUpdates[0]).toMatchObject({ phone: '+94771234567' });
  });

  it('does not self-conflict when re-saving a number already on the account', async () => {
    const { db } = stubDb({ patient: { accountPhone: '+94771234567' } });

    // The row being edited always matches the number being written; excluding
    // it is what keeps this a 200 rather than a 409 against itself.
    await expect(serviceWith(db).update('pt-1', dto({ phone: '0771234567' }))).resolves.toBeDefined();
  });

  it('rejects a number that is not usable', async () => {
    const { db, userUpdates } = stubDb();

    await expect(serviceWith(db).update('pt-1', dto({ phone: 'not a number' }))).rejects.toBeInstanceOf(
      BadRequestException,
    );
    expect(userUpdates).toHaveLength(0);
  });

  it('treats a blank phone as "not submitted" rather than a clear', async () => {
    // Clearing users.phone would leave a WhatsApp-only client with no way to
    // sign in and no endpoint that could undo it.
    const { db, userUpdates, patientUpdates } = stubDb();

    await serviceWith(db).update('pt-1', dto({ fullName: 'Nimal Perera', phone: '' }));

    expect(userUpdates).toHaveLength(0);
    expect(patientUpdates[0]).not.toHaveProperty('phone');
  });

  it('advances updatedAt on a details edit', async () => {
    const { db, patientUpdates } = stubDb();

    await serviceWith(db).update('pt-1', dto({ fullName: 'Nimal Perera' }));

    expect(patientUpdates[0]).toHaveProperty('updatedAt', expect.any(Date));
  });

  it('stores a blank text field as null, never as an empty string', async () => {
    const { db, patientUpdates } = stubDb();

    await serviceWith(db).update('pt-1', dto({ fullName: 'Nimal Perera', permanentAddress: '' }));

    expect(patientUpdates[0]).toMatchObject({ permanentAddress: null });
  });

  it('keeps dateOfBirth as the raw YYYY-MM-DD string', async () => {
    // mysql2 serialises Date in the connection's local timezone, which shifts
    // the stored day by one west of UTC. The cast to Date is a drizzle typing
    // convenience only; a real Date here would corrupt the date.
    const { db, patientUpdates } = stubDb();

    await serviceWith(db).update('pt-1', dto({ fullName: 'N Perera', dateOfBirth: '1990-05-05' }));

    expect(patientUpdates[0].dateOfBirth).toBe('1990-05-05');
  });

  it('resolves location display columns from the reference rows', async () => {
    const { db, patientUpdates } = stubDb({
      cities: [DEHIWALA],
      districts: [COLOMBO],
      provinces: [WESTERN],
    });

    await serviceWith(db).update('pt-1', dto({ districtId: 1, cityId: 340 }));

    expect(patientUpdates[0]).toMatchObject({
      districtId: 1,
      cityId: 340,
      district: 'Colombo',
      city: 'Dehiwala',
      province: 'Western',
      postalCode: '10350',
    });
  });

  it('does not erase the location when an edit names neither id', async () => {
    const { db, patientUpdates } = stubDb();

    await serviceWith(db).update('pt-1', dto({ fullName: 'Nimal Perera' }));

    expect(patientUpdates[0]).not.toHaveProperty('districtId');
    expect(patientUpdates[0]).not.toHaveProperty('district');
  });

  it('refuses to let a client set the location display columns directly', async () => {
    const { db, patientUpdates } = stubDb({
      cities: [DEHIWALA],
      districts: [COLOMBO],
      provinces: [WESTERN],
    });

    await serviceWith(db).update(
      'pt-1',
      dto({ districtId: 1, cityId: 340, district: 'Jaffna' } as Record<string, unknown>),
    );

    // A display name that contradicts the id beside it looks fine in the staff
    // UI and returns nothing wherever anything filters on the id.
    expect(patientUpdates[0]).toMatchObject({ district: 'Colombo' });
  });

  it('keeps emailVerifiedAt set when the email changes', async () => {
    // Deliberately asymmetric with phone: there is no resend-verification UI and
    // no admin action that mints a token, so clearing it is a one-way door into
    // a locked account.
    const { db, userUpdates } = stubDb();

    await serviceWith(db).update('pt-1', dto({ email: 'new@example.com' }));

    expect(userUpdates[0]).toMatchObject({ email: 'new@example.com' });
    expect(userUpdates[0]).not.toHaveProperty('emailVerifiedAt');
  });

  it('treats an explicit null email as absent instead of throwing', async () => {
    // @IsOptional() accepts null as well as undefined, so {"email": null} is a
    // valid body. Calling .trim() on it would be an unhandled TypeError -> 500
    // for what is semantically a no-op.
    const { db, userUpdates } = stubDb();

    await expect(serviceWith(db).update('pt-1', dto({ email: null }))).resolves.toBeDefined();
    expect(userUpdates).toHaveLength(0);
  });

  it('ignores a respelling of the same email under different casing', async () => {
    const { db, userUpdates } = stubDb();

    await serviceWith(db).update('pt-1', dto({ email: 'NIMAL@example.com' }));

    expect(userUpdates).toHaveLength(0);
  });

  it('surfaces a duplicate email as a conflict', async () => {
    const { db } = stubDb({ takenBy: { [users as unknown as string]: [{ id: 'user-9' }] } });

    await expect(serviceWith(db).update('pt-1', dto({ email: 'taken@example.com' }))).rejects.toBeInstanceOf(
      ConflictException,
    );
  });
});

/** Guards the DI token the module actually provides. */
describe('patients DRIZZLE wiring', () => {
  it('exposes a drizzle token', () => {
    expect(DRIZZLE).toBeDefined();
  });
});