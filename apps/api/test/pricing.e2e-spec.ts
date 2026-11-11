import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import type { CaregiverRateCard, CareTypePricing } from '@care-platform/shared';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { caregivers } from '../src/database/schema';
import { SEED_PASSWORD } from './seed-password';
// Job offers set prices too: their cases run here, in this worker, one after the other.
import './offers.cases';

/**
 * Caregiver-set rates over real HTTP: the admin sets a band and a fee per
 * kind of care; a caregiver sets their own rate inside it (and only their
 * own); staff can do it for them; and a booking is quoted from it - or not
 * at all when there is nothing sound to quote.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

describe('Caregiver rates (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let staffToken: string;
  let adminToken: string;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const run = (Math.floor(Date.now() / 1000) + 2500) % 10_000;
  let n = 0;
  const pricing = (careType: string, body: object, token = adminToken) => api().patch(`/settings/pricing/${careType}`).set(bearer(token)).send(body);
  const line = (card: CaregiverRateCard, careType: string) => card.lines.find((l) => l.careType === careType)!;

  async function newCaregiver() {
    const phone = `072${String(run * 1000 + ++n).padStart(7, '0')}`;
    const reg = await api()
      .post('/auth/register-caregiver/unified')
      .send({
        phone, consentAccepted: true, fullName: `Rated Caregiver ${phone}`, permanentAddress: '1 Lake Road, Kandy',
        dateOfBirth: '1988-01-20', gender: 'FEMALE', civilStatus: 'MARRIED', emergencyContactName: 'EC', emergencyContactNumber: '0770001111',
        emergencyContactRelationship: 'Husband',
      })
      .expect(201);
    const [row] = await db.select().from(caregivers).where(eq(caregivers.registrationNumber, reg.body.registrationNumber));
    const token = app
      .get(JwtService)
      .sign({ sub: row.userId, role: 'CAREGIVER', caregiverId: row.id }, { secret: app.get(ConfigService).get<string>('JWT_ACCESS_SECRET')!, expiresIn: '10m' });
    return { id: row.id, token };
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(unlimitedThrottle).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get<Database>(DRIZZLE);
    const login = (email: string) => api().post('/auth/login').send({ email, password: SEED_PASSWORD });
    staffToken = (await login('staff@care-platform.local')).body.accessToken;
    adminToken = (await login('admin@care-platform.local')).body.accessToken;
  });

  beforeEach(async () => {
    await db.execute(sql`DELETE FROM care_type_pricing`);
  });

  afterAll(async () => {
    await db.execute(sql`DELETE FROM care_type_pricing`);
    await app.close();
  });

  it('starts with own rates off for every kind of care, and only an admin can change that', async () => {
    const start = (await api().get('/settings/pricing').set(bearer(staffToken)).expect(200)).body as CareTypePricing[];
    expect(start.map((p) => p.careType)).toEqual(['HOME_SHIFT', 'LIVE_IN', 'HOSPITAL', 'NURSING_HOME', 'RETIREMENT_HOME']);
    expect(start.every((p) => !p.enabled && p.maxRate === 0 && p.feePercent === 0)).toBe(true);

    await pricing('HOME_SHIFT', { enabled: true }, staffToken).expect(403);
    await pricing('HOME_SHIFT', { enabled: true }).expect(400); // no band yet
    await pricing('HOME_SHIFT', { minRate: 6000, maxRate: 2500 }).expect(400);
    await pricing('HOME_SHIFT', { feePercent: 101 }).expect(400);
    await pricing('DAY_CARE', { enabled: true }).expect(400);

    const set = (await pricing('HOME_SHIFT', { enabled: true, rateType: 'DAILY', minRate: 2500, maxRate: 6000, feePercent: 15 }).expect(200)).body as CareTypePricing[];
    expect(set[0]).toEqual({ careType: 'HOME_SHIFT', enabled: true, rateType: 'DAILY', minRate: 2500, maxRate: 6000, feePercent: 15 });
    expect(set[1].enabled).toBe(false);
  });

  it('lets a caregiver set their own rate inside the band, and nobody else\'s', async () => {
    await pricing('HOME_SHIFT', { enabled: true, rateType: 'DAILY', minRate: 2500, maxRate: 6000, feePercent: 15 }).expect(200);
    await pricing('LIVE_IN', { enabled: true, rateType: 'MONTHLY', minRate: 60000, maxRate: 150000, feePercent: 12.5 }).expect(200);
    const me = await newCaregiver();
    const other = await newCaregiver();
    const put = (id: string, rates: object[], token = me.token) => api().put(`/caregivers/${id}/rates`).set(bearer(token)).send({ rates });

    const empty = (await api().get(`/caregivers/${me.id}/rates`).set(bearer(me.token)).expect(200)).body as CaregiverRateCard;
    expect(line(empty, 'HOME_SHIFT')).toMatchObject({ offered: true, amount: null, clientPrice: null, outOfBand: false, pricing: { enabled: true, minRate: 2500, maxRate: 6000 } });
    expect(line(empty, 'HOSPITAL').pricing.enabled).toBe(false);

    await put(me.id, [{ careType: 'HOME_SHIFT', amount: 2400 }]).expect(400);
    await put(me.id, [{ careType: 'HOME_SHIFT', amount: 6001 }]).expect(400);
    await put(me.id, [{ careType: 'HOME_SHIFT', amount: 0 }]).expect(400);
    expect((await put(me.id, [{ careType: 'HOSPITAL', amount: 3000 }]).expect(400)).body.message).toBe('Rates for this kind of care are set by the office');
    await put(me.id, [{ careType: 'HOME_SHIFT', amount: 3000 }, { careType: 'HOME_SHIFT', amount: 3500 }]).expect(400);
    // One bad line saves nothing.
    await put(me.id, [{ careType: 'HOME_SHIFT', amount: 3000 }, { careType: 'LIVE_IN', amount: 10 }]).expect(400);
    expect(line((await api().get(`/caregivers/${me.id}/rates`).set(bearer(me.token)).expect(200)).body, 'HOME_SHIFT').amount).toBeNull();

    const saved = (await put(me.id, [{ careType: 'HOME_SHIFT', amount: 3000 }, { careType: 'LIVE_IN', amount: 85000 }]).expect(200)).body as CaregiverRateCard;
    expect(line(saved, 'HOME_SHIFT')).toMatchObject({ amount: 3000, clientPrice: 3450 });
    expect(line(saved, 'LIVE_IN')).toMatchObject({ amount: 85000, clientPrice: 95625 });

    // Another caregiver can neither read nor change it; staff can do both.
    await api().get(`/caregivers/${me.id}/rates`).set(bearer(other.token)).expect(403);
    await put(me.id, [{ careType: 'HOME_SHIFT', amount: 2500 }], other.token).expect(403);
    await api().get(`/caregivers/${me.id}/rates`).expect(401);
    const byStaff = (await put(me.id, [{ careType: 'HOME_SHIFT', amount: 3500 }], staffToken).expect(200)).body as CaregiverRateCard;
    expect(line(byStaff, 'HOME_SHIFT')).toMatchObject({ amount: 3500, clientPrice: 4025 });
    expect(line(byStaff, 'LIVE_IN').amount).toBe(85000); // untouched

    // Removing a rate.
    const removed = (await put(me.id, [{ careType: 'LIVE_IN', amount: null }]).expect(200)).body as CaregiverRateCard;
    expect(line(removed, 'LIVE_IN')).toMatchObject({ amount: null, clientPrice: null });
  });

  it('quotes a booking from the rate, and gives no quote when there is nothing sound to quote', async () => {
    await pricing('HOME_SHIFT', { enabled: true, rateType: 'DAILY', minRate: 2500, maxRate: 6000, feePercent: 15 }).expect(200);
    const cg = await newCaregiver();
    const quote = async (careType: string) => (await api().get(`/caregivers/${cg.id}/rates/quote/${careType}`).set(bearer(staffToken)).expect(200)).body.quote;
    await api().get(`/caregivers/${cg.id}/rates/quote/HOME_SHIFT`).set(bearer(cg.token)).expect(403);

    expect(await quote('HOME_SHIFT')).toBeNull(); // no rate set
    await api().put(`/caregivers/${cg.id}/rates`).set(bearer(cg.token)).send({ rates: [{ careType: 'HOME_SHIFT', amount: 3000 }] }).expect(200);
    expect(await quote('HOME_SHIFT')).toEqual({ careType: 'HOME_SHIFT', rateType: 'DAILY', payRate: 3000, feePercent: 15, clientRate: 3450 });
    expect(await quote('HOSPITAL')).toBeNull(); // own rates off for hospital care

    // A fee change shows at once: the client's price is never stored.
    await pricing('HOME_SHIFT', { feePercent: 20 }).expect(200);
    expect(await quote('HOME_SHIFT')).toMatchObject({ payRate: 3000, clientRate: 3600 });

    // The admin moves the band above the caregiver's rate: flagged, and not quoted until they update it.
    await pricing('HOME_SHIFT', { minRate: 3200 }).expect(200);
    const card = (await api().get(`/caregivers/${cg.id}/rates`).set(bearer(cg.token)).expect(200)).body as CaregiverRateCard;
    expect(line(card, 'HOME_SHIFT')).toMatchObject({ amount: 3000, outOfBand: true });
    expect(await quote('HOME_SHIFT')).toBeNull();

    // Switched off again: the rate is kept, but nothing is quoted.
    await pricing('HOME_SHIFT', { minRate: 2500, enabled: false }).expect(200);
    expect(await quote('HOME_SHIFT')).toBeNull();
    await api().get(`/caregivers/00000000-0000-4000-8000-000000000000/rates`).set(bearer(staffToken)).expect(404);
  });
});
