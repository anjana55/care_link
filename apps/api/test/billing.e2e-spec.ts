import { createHash } from 'crypto';
import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { addDays, colomboToday, isoWeekday } from '@care-platform/shared';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { caregivers, patients } from '../src/database/schema';
import { SEED_PASSWORD } from './seed-password';

/**
 * Invoicing, payments and payouts over real HTTP: staff bill a client from
 * the shifts that happened, shape the draft (prices, discounts, credits, tax),
 * issue it and take payment - by hand or through PayHere - and pay caregivers
 * for the shifts they worked. Above all: a shift is never billed, or paid,
 * twice, and PayHere is only believed when its signature checks out.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};
const md5 = (s: string) => createHash('md5').update(s).digest('hex').toUpperCase();
const MERCHANT = '1211149';
const SECRET = 'e2e-merchant-secret';

describe('Invoicing and payouts (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let jwt: JwtService;
  let accessSecret: string;
  let staffToken: string;
  let adminToken: string;
  let verifierToken: string;
  let intake: Record<string, unknown>;

  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const run = Math.floor(Date.now() / 1000) % 10_000;
  let n = 0;
  const newPhone = () => `071${String(run * 1000 + ++n).padStart(7, '0')}`;

  /** Monday of the week `weeksAgo` weeks back (Colombo): its Mon-Fri shifts are all in the past. */
  const mondayWeeksAgo = (weeksAgo: number) => {
    let d = addDays(colomboToday(), -7 * weeksAgo);
    while (isoWeekday(d) !== 1) d = addDays(d, -1);
    return d;
  };

  async function newCaregiver() {
    const phone = newPhone();
    const reg = await api()
      .post('/auth/register-caregiver/unified')
      .send({
        phone, consentAccepted: true, fullName: `Billed Caregiver ${phone}`, permanentAddress: '1 Lake Road, Kandy',
        dateOfBirth: '1988-01-20', gender: 'FEMALE', civilStatus: 'MARRIED', emergencyContactName: 'EC', emergencyContactNumber: '0770001111',
        emergencyContactRelationship: 'Husband',
      })
      .expect(201);
    const [row] = await db.select().from(caregivers).where(eq(caregivers.registrationNumber, reg.body.registrationNumber));
    await db.execute(sql`UPDATE caregivers SET status = 'ACTIVE' WHERE id = ${row.id}`);
    const token = jwt.sign({ sub: row.userId, role: 'CAREGIVER', caregiverId: row.id }, { secret: accessSecret, expiresIn: '10m' });
    return { id: row.id, token };
  }

  async function newClient() {
    const reg = await api()
      .post('/auth/register-patient')
      .send({ email: `billing-client-${run}-${++n}@example.com`, password: 'SelfRegPass123', fullName: 'Nimal Kumara Perera', phone: newPhone(), consentAccepted: true, ...intake })
      .expect(201);
    const [row] = await db.select().from(patients).where(eq(patients.id, reg.body.patientId));
    const token = jwt.sign({ sub: row.userId, role: 'PATIENT_GUARDIAN', patientId: row.id }, { secret: accessSecret, expiresIn: '10m' });
    return { patientId: row.id, token };
  }

  /** A confirmed Mon-Fri, 08:00-17:00 booking in a past week, with its five shifts. */
  async function pastBooking(weeksAgo: number, rates: Record<string, unknown> = {}) {
    const cg = await newCaregiver();
    const client = await newClient();
    const monday = mondayWeeksAgo(weeksAgo);
    const created = await api()
      .post('/bookings')
      .set(bearer(staffToken))
      .send({
        patientId: client.patientId, caregiverId: cg.id, scheduleType: 'DAY', daysOfWeek: [1, 2, 3, 4, 5], shiftStartTime: '08:00', shiftEndTime: '17:00',
        startDate: monday, endDate: addDays(monday, 4), rateType: 'DAILY', rateAmount: '3500.00', payRateType: 'DAILY', payRateAmount: '2500.00', ...rates,
      })
      .expect(201);
    const confirmed = await api().post(`/bookings/${created.body.id}/confirm`).set(bearer(staffToken)).expect(200);
    return { cg, client, monday, booking: confirmed.body as { id: string; reference: string; shifts: { id: string }[] } };
  }

  const setShift = (bookingId: string, shiftId: string, body: Record<string, unknown>) =>
    api().patch(`/bookings/${bookingId}/shifts/${shiftId}`).set(bearer(staffToken)).send(body).expect(200);
  const invoice = (id: string, token = staffToken) => api().get(`/invoices/${id}`).set(bearer(token));
  const settings = (body: Record<string, unknown>) => api().patch('/settings/billing').set(bearer(adminToken)).send(body);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(unlimitedThrottle).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get<Database>(DRIZZLE);
    jwt = app.get(JwtService);
    accessSecret = app.get(ConfigService).get<string>('JWT_ACCESS_SECRET')!;
    const login = (email: string) => api().post('/auth/login').send({ email, password: SEED_PASSWORD });
    staffToken = (await login('staff@care-platform.local')).body.accessToken;
    adminToken = (await login('admin@care-platform.local')).body.accessToken;
    verifierToken = (await login('verifier@care-platform.local')).body.accessToken;
    const tree = (await api().get('/public/meta/locations/tree?locale=en').expect(200)).body as { districts: { id: number }[] }[];
    const districtId = tree.flatMap((p) => p.districts)[0].id;
    const cityId = (await api().get(`/public/meta/locations/cities?districtId=${districtId}&locale=en`).expect(200)).body[0].id;
    intake = {
      registrantType: 'GUARDIAN', recipientName: 'Sunil Fernando', recipientRelationship: 'PARENT', recipientAge: 78, recipientGender: 'MALE',
      preferredContactMethod: 'PHONE_CALL', districtId, cityId, careNeeds: 'Needs help with bathing, meals and medication reminders.',
      careSchedule: 'DAY', careStart: 'WITHIN_WEEK',
    };
    // Start from a fresh install's billing settings, whatever an earlier run or a person left behind.
    await settings({ taxEnabled: false, payhereEnabled: false, clearPayhereMerchantSecret: true, payhereMerchantId: '' }).expect(200);
  });

  // Tax is one shared switch: a test that turns it on must not leak it into the next.
  afterEach(async () => {
    await settings({ taxEnabled: false });
  });

  afterAll(async () => {
    // Billing settings are one shared row: leave them as a fresh install has them.
    await settings({ taxEnabled: false, payhereEnabled: false, clearPayhereMerchantSecret: true, payhereMerchantId: '' });
    await app.close();
  });

  it('bills completed shifts, lets staff shape the draft, and never bills a shift twice', async () => {
    const { client, monday, booking } = await pastBooking(2);
    const [s0, s1, s2, s3] = booking.shifts;
    await setShift(booking.id, s0.id, { status: 'COMPLETED' });
    await setShift(booking.id, s1.id, { status: 'COMPLETED' });
    await setShift(booking.id, s2.id, { status: 'MISSED' });
    await setShift(booking.id, s3.id, { status: 'COMPLETED' });
    const period = { periodStart: monday, periodEnd: addDays(monday, 6) };

    const draft = await api().post('/invoices').set(bearer(staffToken)).send({ bookingId: booking.id, basis: 'COMPLETED', ...period }).expect(201);
    expect(draft.body.status).toBe('DRAFT');
    expect(draft.body.number).toBeNull();
    expect(draft.body.generated).toEqual({ added: 3, skipped: 0, unpriced: 0 });
    expect(draft.body.lines.map((l: { shiftId: string }) => l.shiftId)).toEqual([s0.id, s1.id, s3.id]);
    expect(draft.body.total).toBe('10500.00');
    expect(draft.body.billToName).toBe('Nimal Kumara Perera');

    // The client cannot see a draft.
    expect((await api().get('/me/invoices').set(bearer(client.token)).expect(200)).body).toEqual([]);
    await api().get(`/me/invoices/${draft.body.id}`).set(bearer(client.token)).expect(404);

    // A second invoice for the same period finds nothing left to bill.
    const again = await api().post('/invoices').set(bearer(staffToken)).send({ bookingId: booking.id, basis: 'COMPLETED', ...period }).expect(201);
    expect(again.body.generated).toEqual({ added: 0, skipped: 3, unpriced: 0 });
    await api().delete(`/invoices/${again.body.id}`).set(bearer(staffToken)).expect(200);

    // Shape it: a cheaper shift, a discounted one, a charge, a credit, an invoice discount.
    const lines = draft.body.lines.map((l: Record<string, unknown>) => ({ id: l.id, kind: l.kind, description: l.description, serviceDate: l.serviceDate, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice }));
    lines[0].unitPrice = '3000.00';
    lines[1] = { ...lines[1], discountType: 'PERCENT', discountValue: '10' };
    const shaped = await api()
      .put(`/invoices/${draft.body.id}/lines`)
      .set(bearer(staffToken))
      .send({
        lines: [
          ...lines,
          { kind: 'ITEM', description: 'Transport', quantity: '2', unit: 'ITEM', unitPrice: '750.00', taxable: false },
          { kind: 'ADJUSTMENT', description: 'Late start on Monday', quantity: '1', unit: 'ITEM', unitPrice: '-500.00' },
        ],
      })
      .expect(200);
    // 3000 + 3150 + 3500 + 1500 - 500
    expect(shaped.body.subtotal).toBe('10650.00');
    expect(shaped.body.lines.map((l: { shiftId: string | null }) => l.shiftId)).toEqual([s0.id, s1.id, s3.id, null, null]);

    // The browser cannot invent a shift line, or make a charge negative.
    await api().put(`/invoices/${draft.body.id}/lines`).set(bearer(staffToken)).send({ lines: [{ kind: 'SHIFT', description: 'x', quantity: '1', unit: 'DAY', unitPrice: '1' }] }).expect(400);
    await api().put(`/invoices/${draft.body.id}/lines`).set(bearer(staffToken)).send({ lines: [{ kind: 'ITEM', description: 'x', quantity: '1', unit: 'ITEM', unitPrice: '-1' }] }).expect(400);

    // Tax only once it is on in settings; then 18% on the taxable lines after the discount share.
    await api().patch(`/invoices/${draft.body.id}`).set(bearer(staffToken)).send({ applyTax: true }).expect(400);
    await settings({ taxEnabled: true, taxName: 'VAT', taxRate: '18', taxRegistrationNumber: '123456789-7000' }).expect(200);
    const taxed = await api()
      .patch(`/invoices/${draft.body.id}`)
      .set(bearer(staffToken))
      .send({ applyTax: true, discountType: 'AMOUNT', discountValue: '650.00', discountReason: 'Goodwill', notes: 'Thank you for choosing CareLink.' })
      .expect(200);
    // discount 650 of 10650; taxable lines 9150 carry 9150/10650 of it = 558.45; tax 18% of 8591.55
    expect(taxed.body.discountAmount).toBe('650.00');
    expect(taxed.body.taxableAmount).toBe('8591.55');
    expect(taxed.body.taxAmount).toBe('1546.48');
    expect(taxed.body.total).toBe('11546.48');

    // Issue: numbered, frozen, visible to the client.
    const issued = await api().post(`/invoices/${draft.body.id}/issue`).set(bearer(staffToken)).send({ notify: false }).expect(200);
    expect(issued.body.status).toBe('ISSUED');
    expect(issued.body.number).toMatch(/^INV-\d{6}$/);
    expect(issued.body.issueDate).toBe(colomboToday());
    expect(issued.body.dueDate).toBe(addDays(colomboToday(), 7));
    expect(issued.body.seller.taxRegistrationNumber).toBe('123456789-7000');
    await api().put(`/invoices/${draft.body.id}/lines`).set(bearer(staffToken)).send({ lines }).expect(400);
    await api().post(`/invoices/${draft.body.id}/issue`).set(bearer(staffToken)).send({}).expect(400);
    // A change of business details later never rewrites it.
    await settings({ taxRegistrationNumber: '999' }).expect(200);
    expect((await invoice(draft.body.id).expect(200)).body.seller.taxRegistrationNumber).toBe('123456789-7000');

    const mine = await api().get(`/me/invoices/${draft.body.id}`).set(bearer(client.token)).expect(200);
    expect(mine.body).toMatchObject({ number: issued.body.number, total: '11546.48', balance: '11546.48', taxName: 'VAT', canPayOnline: false });
    expect(mine.body.lines).toHaveLength(5);
    expect(JSON.stringify(mine.body)).not.toMatch(/shiftId|caregiverId|internal/);

    // Payments: part, the rest, then a refund reopens it. No paying more than is owed.
    const pay = (body: Record<string, unknown>) => api().post(`/invoices/${draft.body.id}/payments`).set(bearer(staffToken)).send({ method: 'BANK_TRANSFER', paidOn: colomboToday(), notify: false, ...body });
    await pay({ amount: '99999.00' }).expect(400);
    expect((await pay({ amount: '5000.00', reference: 'Slip 4471' }).expect(201)).body).toMatchObject({ status: 'ISSUED', amountPaid: '5000.00', balance: '6546.48' });
    await api().post(`/invoices/${draft.body.id}/void`).set(bearer(staffToken)).send({ reason: 'Wrong client' }).expect(400);
    const paid = await pay({ amount: '6546.48', method: 'CASH' }).expect(201);
    expect(paid.body).toMatchObject({ status: 'PAID', balance: '0.00' });
    expect(paid.body.paidAt).toBeTruthy();
    const refunded = await pay({ kind: 'REFUND', amount: '546.48' }).expect(201);
    expect(refunded.body).toMatchObject({ status: 'ISSUED', amountPaid: '11000.00', balance: '546.48' });
    const wrong = refunded.body.payments.find((p: { amount: string }) => p.amount.startsWith('-'));
    const removed = await api().delete(`/invoices/${draft.body.id}/payments/${wrong.id}`).set(bearer(staffToken)).expect(200);
    expect(removed.body.status).toBe('PAID');

    const summary = await api().get('/invoices/summary').set(bearer(staffToken)).expect(200);
    expect(summary.body.byStatus.PAID).toBeGreaterThanOrEqual(1);
    await settings({ taxEnabled: false }).expect(200);
  });

  it('bills scheduled shifts in advance, and revises an invoice by voiding it into a corrected copy', async () => {
    const { monday, booking } = await pastBooking(3, { rateType: 'HOURLY', rateAmount: '400.00' });
    const created = await api()
      .post('/invoices')
      .set(bearer(staffToken))
      .send({ bookingId: booking.id, basis: 'SCHEDULED', periodStart: monday, periodEnd: addDays(monday, 6) })
      .expect(201);
    // Five 9-hour shifts at 400/h, none marked done yet.
    expect(created.body.lines).toHaveLength(5);
    expect(created.body.lines[0]).toMatchObject({ quantity: '9.00', unit: 'HOUR', unitPrice: '400.00', amount: '3600.00' });
    expect(created.body.total).toBe('18000.00');
    const issued = await api().post(`/invoices/${created.body.id}/issue`).set(bearer(staffToken)).send({ notify: false }).expect(200);

    const copy = await api().post(`/invoices/${created.body.id}/revise`).set(bearer(staffToken)).send({ reason: 'Wednesday was missed' }).expect(201);
    expect(copy.body.status).toBe('DRAFT');
    expect(copy.body.lines).toHaveLength(5);
    expect(copy.body.events[0].note).toContain(issued.body.number);
    const original = await invoice(created.body.id).expect(200);
    expect(original.body).toMatchObject({ status: 'VOID', voidReason: 'Wednesday was missed', number: issued.body.number });
    // The voided invoice no longer holds its shifts, the copy does.
    const third = await api().post('/invoices').set(bearer(staffToken)).send({ bookingId: booking.id, basis: 'SCHEDULED', periodStart: monday, periodEnd: addDays(monday, 6) }).expect(201);
    expect(third.body.generated.added).toBe(0);
  });

  it('takes payment through PayHere, believing only signed notifications for the exact amount', async () => {
    const { client, monday, booking } = await pastBooking(4);
    for (const s of booking.shifts.slice(0, 2)) await setShift(booking.id, s.id, { status: 'COMPLETED' });
    const draft = await api().post('/invoices').set(bearer(staffToken)).send({ bookingId: booking.id, basis: 'COMPLETED', periodStart: monday, periodEnd: addDays(monday, 6) }).expect(201);
    await api().post(`/invoices/${draft.body.id}/issue`).set(bearer(staffToken)).send({ notify: false }).expect(200);

    // Not offered until an admin has set it up completely.
    await api().post(`/me/invoices/${draft.body.id}/payhere`).set(bearer(client.token)).send({}).expect(400);
    await settings({ payhereEnabled: true, payhereMerchantId: MERCHANT }).expect(400);
    const configured = await settings({ payhereEnabled: true, payhereMode: 'SANDBOX', payhereMerchantId: MERCHANT, payhereMerchantSecret: SECRET }).expect(200);
    expect(configured.body).toMatchObject({ payhereUsable: true, payhereMerchantSecretSet: true, payhereMerchantSecretLast4: 'cret' });
    expect(configured.body).not.toHaveProperty('payhereMerchantSecret');
    expect(configured.body.payhereNotifyUrl).toMatch(/\/api\/payments\/payhere\/notify$/);
    expect((await api().get(`/me/invoices/${draft.body.id}`).set(bearer(client.token)).expect(200)).body.canPayOnline).toBe(true);

    const checkout = await api().post(`/me/invoices/${draft.body.id}/payhere`).set(bearer(client.token)).send({}).expect(200);
    const f = checkout.body.fields as Record<string, string>;
    expect(checkout.body.action).toBe('https://sandbox.payhere.lk/pay/checkout');
    expect(f).toMatchObject({ merchant_id: MERCHANT, amount: '7000.00', currency: 'LKR', first_name: 'Nimal Kumara', last_name: 'Perera', country: 'Sri Lanka' });
    expect(f.hash).toBe(md5(`${MERCHANT}${f.order_id}7000.00LKR${md5(SECRET)}`));
    expect(JSON.stringify(checkout.body)).not.toContain(SECRET);
    // Someone else's invoice cannot be paid from this account.
    const stranger = await newClient();
    await api().post(`/me/invoices/${draft.body.id}/payhere`).set(bearer(stranger.token)).send({}).expect(404);

    // PayHere payment ids are unique for ever, so each run needs its own.
    const paymentId = `3200${run}${Date.now() % 100000}`;
    const notify = (status: string, amount = '7000.00', secret = SECRET) =>
      api()
        .post('/payments/payhere/notify')
        .type('form')
        .send({
          merchant_id: MERCHANT, order_id: f.order_id, payment_id: paymentId, payhere_amount: amount, payhere_currency: 'LKR', status_code: status,
          md5sig: md5(`${MERCHANT}${f.order_id}${amount}LKR${status}${md5(secret)}`), method: 'VISA', status_message: 'Successfully completed',
        });

    await notify('2', '7000.00', 'forged-secret').expect(400);
    await notify('2', '1.00').expect(200); // signed, but not what this checkout was for
    expect((await invoice(draft.body.id).expect(200)).body).toMatchObject({ status: 'ISSUED', amountPaid: '0.00' });

    // A fresh checkout (the last one was marked failed by the bad amount), then the real thing.
    const second = await api().post(`/me/invoices/${draft.body.id}/payhere`).set(bearer(client.token)).send({}).expect(200);
    f.order_id = second.body.fields.order_id;
    await notify('0').expect(200); // pending: nothing moves
    expect((await invoice(draft.body.id).expect(200)).body.status).toBe('ISSUED');
    await notify('2').expect(200);
    await notify('2').expect(200); // PayHere retries; counted once
    const paid = await invoice(draft.body.id).expect(200);
    expect(paid.body).toMatchObject({ status: 'PAID', amountPaid: '7000.00' });
    expect(paid.body.payments).toHaveLength(1);
    expect(paid.body.payments[0]).toMatchObject({ method: 'PAYHERE', reference: paymentId, recordedByUserId: null });
    await api().delete(`/invoices/${draft.body.id}/payments/${paid.body.payments[0].id}`).set(bearer(staffToken)).expect(400);
    await notify('-2').expect(200); // a late failure never undoes a success
    expect((await invoice(draft.body.id).expect(200)).body.status).toBe('PAID');
    await api().post(`/me/invoices/${draft.body.id}/payhere`).set(bearer(client.token)).send({}).expect(400); // nothing left to pay

    // A chargeback takes the money back off the invoice.
    await notify('-3').expect(200);
    expect((await invoice(draft.body.id).expect(200)).body).toMatchObject({ status: 'ISSUED', amountPaid: '0.00' });
  });

  it('pays caregivers for the shifts they worked, covers included, once', async () => {
    const { cg, monday, booking } = await pastBooking(5);
    const cover = await newCaregiver();
    const [s0, s1, s2] = booking.shifts;
    await setShift(booking.id, s1.id, { caregiverId: cover.id });
    for (const s of [s0, s1, s2]) await setShift(booking.id, s.id, { status: 'COMPLETED' });
    const period = { periodStart: monday, periodEnd: addDays(monday, 6) };

    const run1 = await api().post('/payouts/generate').set(bearer(staffToken)).send(period).expect(200);
    expect(run1.body.created).toBeGreaterThanOrEqual(2);
    const list = await api().get(`/payouts?caregiverId=${cg.id}`).set(bearer(staffToken)).expect(200);
    expect(list.body.items).toHaveLength(1);
    const own = await api().get(`/payouts/${list.body.items[0].id}`).set(bearer(staffToken)).expect(200);
    expect(own.body.lines.map((l: { shiftId: string }) => l.shiftId)).toEqual([s0.id, s2.id]);
    expect(own.body.total).toBe('5000.00');
    const coverList = await api().get(`/payouts?caregiverId=${cover.id}`).set(bearer(staffToken)).expect(200);
    expect(coverList.body.items[0].total).toBe('2500.00');

    // Running the pay run again makes nothing new for these two.
    await api().post('/payouts/generate').set(bearer(staffToken)).send(period).expect(200);
    expect((await api().get(`/payouts?caregiverId=${cg.id}`).set(bearer(staffToken)).expect(200)).body.items).toHaveLength(1);

    // A transport allowance and a deduction, then approve and pay.
    const lines = own.body.lines.map((l: Record<string, unknown>) => ({ id: l.id, kind: l.kind, description: l.description, quantity: l.quantity, unit: l.unit, unitPrice: l.unitPrice }));
    const edited = await api()
      .put(`/payouts/${own.body.id}/lines`)
      .set(bearer(staffToken))
      .send({ lines: [...lines, { kind: 'ITEM', description: 'Transport allowance', quantity: '1', unit: 'ITEM', unitPrice: '1000' }, { kind: 'ADJUSTMENT', description: 'Uniform', quantity: '1', unit: 'ITEM', unitPrice: '-300' }] })
      .expect(200);
    expect(edited.body.total).toBe('5700.00');

    expect((await api().get('/me/payouts').set(bearer(cg.token)).expect(200)).body).toEqual([]); // drafts are not shown
    await api().post(`/payouts/${own.body.id}/pay`).set(bearer(staffToken)).send({ paidOn: colomboToday(), method: 'BANK_TRANSFER' }).expect(400);
    await api().post(`/payouts/${own.body.id}/approve`).set(bearer(staffToken)).expect(200);
    await api().put(`/payouts/${own.body.id}/lines`).set(bearer(staffToken)).send({ lines }).expect(400);
    const paid = await api().post(`/payouts/${own.body.id}/pay`).set(bearer(staffToken)).send({ paidOn: colomboToday(), method: 'BANK_TRANSFER', reference: 'TRF-88', notify: false }).expect(200);
    expect(paid.body).toMatchObject({ status: 'PAID', paymentReference: 'TRF-88' });
    await api().post(`/payouts/${own.body.id}/void`).set(bearer(staffToken)).send({ reason: 'x' }).expect(400);

    const mine = await api().get('/me/payouts').set(bearer(cg.token)).expect(200);
    expect(mine.body).toHaveLength(1);
    expect(mine.body[0]).toMatchObject({ status: 'PAID', total: '5700.00', paymentReference: 'TRF-88' });
    expect(mine.body[0].lines).toHaveLength(4);
    // The pay rate is the caregiver's business, not the client's: it never reaches /me/bookings.
    const booked = await api().get(`/bookings/${booking.id}`).set(bearer(staffToken)).expect(200);
    expect(booked.body.payEstimate.total).toBe('12500.00');
  });

  it('keeps billing to staff, each client to their own invoices, and issued invoices past a client deletion', async () => {
    const { client, monday, booking } = await pastBooking(6);
    await setShift(booking.id, booking.shifts[0].id, { status: 'COMPLETED' });
    const draft = await api().post('/invoices').set(bearer(staffToken)).send({ bookingId: booking.id, basis: 'COMPLETED', periodStart: monday, periodEnd: addDays(monday, 6) }).expect(201);

    await api().get('/invoices').set(bearer(verifierToken)).expect(403);
    await api().get('/payouts').set(bearer(verifierToken)).expect(403);
    await api().get('/invoices').set(bearer(client.token)).expect(403);
    await api().get('/settings/billing').set(bearer(staffToken)).expect(403);
    await api().get('/me/payouts').set(bearer(client.token)).expect(403);
    const clientBookings = await api().get('/me/bookings').set(bearer(client.token)).expect(200);
    expect(JSON.stringify(clientBookings.body)).not.toMatch(/payRate|2500/);

    // A client with only a draft can be deleted (the draft goes); with an issued invoice, not.
    await api().post(`/invoices/${draft.body.id}/issue`).set(bearer(staffToken)).send({ notify: false }).expect(200);
    await api().delete(`/patients/${client.patientId}`).set(bearer(adminToken)).expect(400);

    const other = await pastBooking(7);
    await setShift(other.booking.id, other.booking.shifts[0].id, { status: 'COMPLETED' });
    const otherDraft = await api().post('/invoices').set(bearer(staffToken)).send({ patientId: other.client.patientId, basis: 'MANUAL' }).expect(201);
    expect(otherDraft.body.lines).toEqual([]);
    await api().delete(`/patients/${other.client.patientId}`).set(bearer(adminToken)).expect(200);
    await invoice(otherDraft.body.id).expect(404);
  });
});
