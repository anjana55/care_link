import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { caregivers } from '../src/database/schema';
import { CAREGIVER_COLUMNS } from '../src/data-transfer/caregiver-transfer.service';
import { toCsv } from '../src/data-transfer/csv.util';
import { SEED_PASSWORD } from './seed-password';

/**
 * Caregiver import, over real HTTP against the real database: what it takes
 * as written (NIC, height, weight) and what still stops a row.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

type Issue = { code: string; column?: string; value?: string };
type Row = { row: number; name: string; outcome: string; errors: Issue[]; warnings: Issue[]; id?: string };

describe('Caregiver import (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let adminToken: string;
  const run = Math.floor(Date.now() / 1000) % 100_000;
  let n = 0;
  const phone = () => `075${String(run * 100 + ++n).padStart(7, '0')}`;

  const row = (overrides: Record<string, string>): Record<string, string> => ({
    fullName: `Import Test ${run}-${++n}`,
    dateOfBirth: '1985-02-01',
    gender: 'FEMALE',
    civilStatus: 'SINGLE',
    primaryPhone: phone(),
    permanentAddress: '1 Lake Road, Galle',
    emergencyContactName: 'W B M Wijesinghe',
    emergencyContactNumber: '0712345678',
    emergencyContactRelationship: 'Mother',
    ...overrides,
  });

  const importRows = async (rows: Record<string, string>[], dryRun: boolean) => {
    const csv = toCsv<Record<string, string>>(
      CAREGIVER_COLUMNS.map((c) => ({ header: c.header, value: (r) => r[c.key] ?? '' })),
      rows,
    );
    const res = await request(app.getHttpServer())
      .post('/data-transfer/caregivers/import')
      .set({ Authorization: `Bearer ${adminToken}` })
      .field('dryRun', String(dryRun))
      .attach('file', Buffer.from(csv, 'utf8'), 'caregivers.csv');
    expect(res.status).toBeLessThan(300);
    return res.body as { rows: Row[]; created: number; errors: number };
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(unlimitedThrottle).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get<Database>(DRIZZLE);
    adminToken = (await request(app.getHttpServer()).post('/auth/login').send({ email: 'admin@care-platform.local', password: SEED_PASSWORD })).body.accessToken;
    expect(adminToken).toBeTruthy();
  });

  afterAll(async () => {
    await app.close();
  });

  it('takes the NIC as written, and height and weight of 0', async () => {
    const nic = `20017${String(run).padStart(5, '0')}81V`; // 13 characters: not an old or new NIC shape
    const report = await importRows([row({ nic, heightIn: '0', weightKg: '0' })], false);
    const [r] = report.rows;
    expect(r).toMatchObject({ outcome: 'CREATED', errors: [], warnings: [] });

    const [c] = await db.select().from(caregivers).where(eq(caregivers.id, r.id!));
    expect(c).toMatchObject({ nic, heightIn: 0, weightKg: 0 });
  });

  it('leaves a height or weight that is not a number blank, with a warning, and still adds the row', async () => {
    const report = await importRows([row({ heightIn: "5' 2\"", weightKg: 'about 60', nic: '' })], false);
    const [r] = report.rows;
    expect(r.outcome).toBe('CREATED');
    expect(r.warnings.map((w) => [w.code, w.column])).toEqual([
      ['notNumber', 'Height (inches)'],
      ['notNumber', 'Weight (kg)'],
    ]);
    const [c] = await db.select().from(caregivers).where(eq(caregivers.id, r.id!));
    expect(c).toMatchObject({ heightIn: null, weightKg: null });
  });

  it('still refuses a name in the emergency contact number', async () => {
    const report = await importRows([row({ emergencyContactNumber: 'W B M Wijesinghe' })], true);
    expect(report.rows[0].errors).toEqual([{ code: 'invalid', column: 'Emergency contact number', value: 'W B M Wijesinghe' }]);
  });
});
