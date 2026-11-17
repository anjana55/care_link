import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { addDays, colomboToday, formatLkr, isoWeekday, toColombo } from '@care-platform/shared';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { agentDecisions, bookings, caregivers, invoices, patients, payoutStatements, users } from '../src/database/schema';
import { AutomationService } from '../src/automation/automation.service';
import { BillingAgentService, endOfPreviousMonth, monthStart } from '../src/billing/billing-agent.service';
import { BILLING_BOOKING_JOB } from '../src/billing/billing-agent-jobs';
import { INVOICE_PAID_JOB } from '../src/billing/advance-payment-jobs';
import { PaymentRemindersService } from '../src/billing/payment-reminders.service';
import { AdvancePaymentService } from '../src/billing/advance-payment.service';
import { BookingAgentService } from '../src/bookings/booking-agent.service';
import { EmailService } from '../src/email/email.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { JobsService } from '../src/jobs/jobs.service';
import { SEED_PASSWORD } from './seed-password';

/**
 * The billing agent over real HTTP and MySQL: it does nothing in Manual, only
 * logs (and scores itself against staff) in Shadow, proposes in Assist - where
 * a staff member's approval creates and issues the invoice - and bills alone
 * in Auto. In every mode a shift is billed at most once, and anything the
 * agent cannot bill exactly goes to staff with the reason.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

describe('Billing agent (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let jwt: JwtService;
  let accessSecret: string;
  let staffToken: string;
  let adminToken: string;
  let agent: BillingAgentService;
  let automation: AutomationService;
  let intake: Record<string, unknown>;

  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const run = (Math.floor(Date.now() / 1000) + 5000) % 10_000;
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
      .send({ email: `agent-client-${run}-${++n}@example.com`, password: 'SelfRegPass123', fullName: 'Nimal Kumara Perera', phone: newPhone(), consentAccepted: true, ...intake })
      .expect(201);
    const [row] = await db.select().from(patients).where(eq(patients.id, reg.body.patientId));
    const token = jwt.sign({ sub: row.userId, role: 'PATIENT_GUARDIAN', patientId: row.id }, { secret: accessSecret, expiresIn: '10m' });
    return { patientId: row.id, userId: row.userId, token };
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
  const mode = (m: string) => api().patch('/settings/automation/functions/BILLING').set(bearer(adminToken)).send({ mode: m }).expect(200);
  const decisionsFor = (bookingId: string) =>
    db.select().from(agentDecisions).where(and(eq(agentDecisions.caseType, 'BOOKING'), eq(agentDecisions.caseId, bookingId))).orderBy(agentDecisions.createdAt);
  const invoicesFor = (bookingId: string) => db.select().from(invoices).where(eq(invoices.bookingId, bookingId));
  /** Sweeps only this suite's bookings: other suites run at the same time and own theirs. */
  const sweep = (...made: { booking: { id: string } }[]) => agent.sweep(new Date(), made.map((m) => m.booking.id));
  const bookingRow = async (id: string) => (await db.select().from(bookings).where(eq(bookings.id, id)))[0];
  const panel = async (bookingId: string) => (await api().get(`/automation/cases/BOOKING/${bookingId}`).set(bearer(staffToken)).expect(200)).body;

  /** A finished booking: five completed shifts at LKR 3,500 a day = LKR 17,500. */
  async function finishedBooking(weeksAgo = 2) {
    const made = await pastBooking(weeksAgo);
    for (const s of made.booking.shifts) await setShift(made.booking.id, s.id, { status: 'COMPLETED' });
    await db.execute(sql`UPDATE bookings SET status = 'COMPLETED' WHERE id = ${made.booking.id}`);
    return made;
  }
  const billByHand = async (bookingId: string, monday: string) => {
    const draft = await api().post('/invoices').set(bearer(staffToken)).send({ bookingId, basis: 'COMPLETED', periodStart: monday, periodEnd: addDays(monday, 4) }).expect(201);
    return (await api().post(`/invoices/${draft.body.id}/issue`).set(bearer(staffToken)).send({ notify: false }).expect(200)).body;
  };

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(unlimitedThrottle).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get<Database>(DRIZZLE);
    jwt = app.get(JwtService);
    agent = app.get(BillingAgentService);
    automation = app.get(AutomationService);
    accessSecret = app.get(ConfigService).get<string>('JWT_ACCESS_SECRET')!;
    const login = (email: string) => api().post('/auth/login').send({ email, password: SEED_PASSWORD });
    staffToken = (await login('staff@care-platform.local')).body.accessToken;
    adminToken = (await login('admin@care-platform.local')).body.accessToken;
    const tree = (await api().get('/public/meta/locations/tree?locale=en').expect(200)).body as { districts: { id: number }[] }[];
    const districtId = tree.flatMap((p) => p.districts)[0].id;
    const cityId = (await api().get(`/public/meta/locations/cities?districtId=${districtId}&locale=en`).expect(200)).body[0].id;
    intake = {
      registrantType: 'GUARDIAN', recipientName: 'Sunil Fernando', recipientRelationship: 'PARENT', recipientAge: 78, recipientGender: 'MALE',
      preferredContactMethod: 'PHONE_CALL', districtId, cityId, careNeeds: 'Needs help with bathing, meals and medication reminders.',
      careSchedule: 'DAY', careStart: 'WITHIN_WEEK',
    };
    await api().patch('/settings/billing').set(bearer(adminToken)).send({ taxEnabled: false }).expect(200);
    await api().post('/settings/automation/master').set(bearer(adminToken)).send({ on: false }).expect(200);
  });

  afterAll(async () => {
    await mode('MANUAL');
    await app.close();
  });

  it('does nothing while Billing is Manual', async () => {
    await mode('MANUAL');
    const { booking } = await finishedBooking();
    const made = { booking };
    expect(await sweep(made)).toMatchObject({ mode: 'MANUAL', considered: 0, decided: 0 });
    expect(await decisionsFor(booking.id)).toHaveLength(0);
    expect(await invoicesFor(booking.id)).toHaveLength(0);
  });

  it('Shadow: logs what it would bill, changes nothing, and scores itself once staff have billed', async () => {
    await mode('SHADOW');
    const same = await finishedBooking();
    const changed = await finishedBooking();

    const first = await sweep(same, changed);
    expect(first).toMatchObject({ mode: 'SHADOW', considered: 2, decided: 2 });
    let d = await decisionsFor(same.booking.id);
    expect(d).toHaveLength(1);
    expect(d[0]).toMatchObject({ action: 'billing.issue_invoice', outcome: 'SHADOW', mode: 'SHADOW', tier: 1, staffVerdict: null, executedAt: null });
    expect(d[0].proposal).toMatchObject({ bookingId: same.booking.id, periodStart: same.monday, periodEnd: addDays(same.monday, 4), lines: 5, subtotalCents: 1_750_000 });
    expect(d[0].reason).toMatch(/5 completed, unbilled lines .* LKR 17,500\.00 before tax/);
    // Nothing a person could see: no invoice, no note on the case, and the proposal names nobody.
    expect(await invoicesFor(same.booking.id)).toHaveLength(0);
    expect((await panel(same.booking.id)).handoverNote).toBeNull();
    expect(JSON.stringify(d[0].proposal)).not.toMatch(/Perera|Fernando|071/);

    // Sweeping again decides nothing new about the same work.
    expect((await sweep(same, changed)).decided).toBe(0);
    expect(await decisionsFor(same.booking.id)).toHaveLength(1);

    // Staff bill the first exactly as the agent would have. On the second they first put one day up to LKR 4,000.
    await db.execute(sql`UPDATE booking_shifts SET rate_type = 'DAILY', rate_amount = 4000 WHERE id = ${changed.booking.shifts[0].id}`);
    await sweep(same, changed);
    expect((await decisionsFor(changed.booking.id)).map((x) => (x.proposal as { subtotalCents: number }).subtotalCents)).toEqual([1_750_000, 1_800_000]);
    const inv = await billByHand(same.booking.id, same.monday);
    await billByHand(changed.booking.id, changed.monday);

    expect((await sweep(same, changed)).scored).toBe(3);
    d = await decisionsFor(same.booking.id);
    expect(d[0]).toMatchObject({ staffVerdict: 'AGREED' });
    expect(d[0].staffNote).toContain(inv.number);
    const [was, now] = await decisionsFor(changed.booking.id);
    expect(was).toMatchObject({ staffVerdict: 'DIFFERED' });
    expect(was.staffNote).toMatch(/staff billed LKR 18,000\.00 .* would have billed LKR 17,500\.00/);
    expect(now).toMatchObject({ staffVerdict: 'AGREED' });
  });

  it('Assist: proposes, and a staff approval creates and issues the invoice under their name', async () => {
    await mode('ASSIST');
    const made = await finishedBooking();
    const { booking, monday } = made;
    await sweep(made);
    const [proposal] = await decisionsFor(booking.id);
    expect(proposal).toMatchObject({ outcome: 'PROPOSED', staffVerdict: null });
    expect(await invoicesFor(booking.id)).toHaveLength(0);
    const before = await panel(booking.id);
    expect(before).toMatchObject({ agentActive: true, mode: 'ASSIST' });
    expect(before.handoverNote.waiting).toBe('Staff to approve or decline the proposal');
    const waiting = (await api().get('/automation/decisions?awaitingStaff=true&function=BILLING').set(bearer(staffToken)).expect(200)).body;
    expect(waiting.some((w: { id: string }) => w.id === proposal.id)).toBe(true);

    const approved = (await api().post(`/automation/decisions/${proposal.id}/approve`).set(bearer(staffToken)).expect(200)).body;
    expect(approved).toMatchObject({ staffVerdict: 'AGREED', executionError: null });
    expect(approved.executedAt).toBeTruthy();
    const [inv] = await invoicesFor(booking.id);
    expect(inv).toMatchObject({ status: 'ISSUED', subtotal: '17500.00', periodStart: monday, periodEnd: addDays(monday, 4) });
    expect(approved.result).toMatchObject({ invoiceId: inv.id, number: inv.number });
    const [staff] = await db.select().from(users).where(eq(users.email, 'staff@care-platform.local'));
    expect(inv.issuedByUserId).toBe(staff.id);
    expect((await panel(booking.id)).handoverNote.done).toContain(inv.number);

    // Approved once only, and the next sweep finds nothing left to bill.
    await api().post(`/automation/decisions/${proposal.id}/approve`).set(bearer(staffToken)).expect(400);
    await sweep(made);
    expect(await decisionsFor(booking.id)).toHaveLength(1);
    expect(await invoicesFor(booking.id)).toHaveLength(1);
  });

  it('Assist: a declined proposal is not raised again, and one overtaken by hand cannot be approved', async () => {
    await mode('ASSIST');
    const declined = await finishedBooking();
    const overtaken = await finishedBooking();
    await sweep(declined, overtaken);

    const [a] = await decisionsFor(declined.booking.id);
    const after = (await api().post(`/automation/decisions/${a.id}/decline`).set(bearer(staffToken)).send({ reason: 'Client has a credit to apply first' }).expect(200)).body;
    expect(after).toMatchObject({ staffVerdict: 'DIFFERED', staffNote: 'Client has a credit to apply first', executedAt: null });
    await api().post(`/automation/decisions/${a.id}/approve`).set(bearer(staffToken)).expect(400);
    await sweep(declined, overtaken);
    expect(await decisionsFor(declined.booking.id)).toHaveLength(1);
    expect(await invoicesFor(declined.booking.id)).toHaveLength(0);

    const [b] = await decisionsFor(overtaken.booking.id);
    await billByHand(overtaken.booking.id, overtaken.monday);
    const refused = await api().post(`/automation/decisions/${b.id}/approve`).set(bearer(staffToken)).expect(400);
    expect(refused.body.message).toBe('This work has already been billed');
    const [still] = await decisionsFor(overtaken.booking.id);
    expect(still).toMatchObject({ staffVerdict: null, executedAt: null, executionError: 'This work has already been billed' });
    expect(await invoicesFor(overtaken.booking.id)).toHaveLength(1);
  });

  it('Auto: bills alone as the billing agent, and leaves what it cannot price or may not touch to staff', async () => {
    await mode('AUTO');
    const ok = await finishedBooking();
    const unpriced = await finishedBooking();
    const takenOver = await finishedBooking();
    await db.execute(sql`UPDATE bookings SET rate_amount = NULL WHERE id = ${unpriced.booking.id}`);
    await db.execute(sql`UPDATE booking_shifts SET rate_amount = NULL, rate_type = NULL WHERE booking_id = ${unpriced.booking.id}`);
    await api().post(`/automation/cases/BOOKING/${takenOver.booking.id}/take-over`).set(bearer(staffToken)).send({ reason: 'Disputed hours' }).expect(200);

    const result = await sweep(ok, unpriced, takenOver);
    expect(result).toMatchObject({ mode: 'AUTO', considered: 3, decided: 1, leftToStaff: 1 });

    const [done] = await decisionsFor(ok.booking.id);
    expect(done).toMatchObject({ outcome: 'EXECUTED', executionError: null, staffVerdict: null });
    expect(done.executedAt).toBeTruthy();
    const [inv] = await invoicesFor(ok.booking.id);
    expect(inv).toMatchObject({ status: 'ISSUED', subtotal: '17500.00' });
    const [agentUser] = await db.select().from(users).where(eq(users.email, 'billing-agent@agents.invalid'));
    expect(agentUser).toMatchObject({ fullName: 'Billing agent (automated)', isActive: false, passwordHash: null });
    expect(inv.issuedByUserId).toBe(agentUser.id);
    // The agent's account cannot be used to sign in.
    await api().post('/auth/login').send({ email: 'billing-agent@agents.invalid', password: SEED_PASSWORD }).expect(401);

    expect(await decisionsFor(unpriced.booking.id)).toHaveLength(0);
    expect(await invoicesFor(unpriced.booking.id)).toHaveLength(0);
    expect((await panel(unpriced.booking.id)).handoverNote.waiting).toBe('Staff: 5 completed shifts have no client rate');

    expect(await decisionsFor(takenOver.booking.id)).toHaveLength(0);
    expect(await invoicesFor(takenOver.booking.id)).toHaveLength(0);

    // Handed back, it is billed on the next sweep; nothing is billed twice.
    await api().post(`/automation/cases/BOOKING/${takenOver.booking.id}/hand-back`).set(bearer(staffToken)).expect(200);
    await sweep(ok, unpriced, takenOver);
    expect(await invoicesFor(takenOver.booking.id)).toHaveLength(1);
    expect(await invoicesFor(ok.booking.id)).toHaveLength(1);

    // Staff undo it: the verdict is recorded against the action.
    await api().post(`/automation/decisions/${done.id}/review`).set(bearer(staffToken)).send({ verdict: 'REVERSED', note: 'Wrong rate agreed by phone' }).expect(200);
  });

  it('bills a booking that is still running only up to the end of last month', async () => {
    await mode('ASSIST');
    const lastMonthEnd = endOfPreviousMonth(colomboToday());
    // A week wholly inside last month or earlier, and one in the current month.
    let weeks = 1;
    while (addDays(mondayWeeksAgo(weeks), 4) > lastMonthEnd) weeks++;
    const older = await pastBooking(weeks);
    for (const s of older.booking.shifts) await setShift(older.booking.id, s.id, { status: 'COMPLETED' });
    expect(endOfPreviousMonth('2026-11-11')).toBe('2026-10-31');
    expect(endOfPreviousMonth('2027-01-05')).toBe('2026-12-31');

    await sweep(older);
    const [p] = await decisionsFor(older.booking.id);
    expect(p).toMatchObject({ outcome: 'PROPOSED' });
    expect((p.proposal as { periodEnd: string }).periodEnd <= lastMonthEnd).toBe(true);

    if (mondayWeeksAgo(1) > lastMonthEnd) {
      const recent = await pastBooking(1);
      for (const s of recent.booking.shifts) await setShift(recent.booking.id, s.id, { status: 'COMPLETED' });
      expect((await sweep(recent)).decided).toBe(0);
      expect(await decisionsFor(recent.booking.id)).toHaveLength(0);
    }
  });

  describe('billing in advance', () => {
    // A month well ahead, so "today" can be placed anywhere around it without touching anything real.
    const first = monthStart(addDays(colomboToday(), 430));
    const nextFirst = monthStart(addDays(first, 35));
    const at = (day: string) => new Date(`${day}T06:00:00Z`);

    /** A confirmed Mon-Fri booking from the 10th of that month to the 20th of the next, at LKR 3,500 a day. */
    async function aheadBooking(extra: Record<string, unknown> = { billingTiming: 'ADVANCE' }) {
      const cg = await newCaregiver();
      const client = await newClient();
      const created = await api()
        .post('/bookings')
        .set(bearer(staffToken))
        .send({
          patientId: client.patientId, caregiverId: cg.id, scheduleType: 'DAY', daysOfWeek: [1, 2, 3, 4, 5], shiftStartTime: '08:00', shiftEndTime: '17:00',
          startDate: addDays(first, 9), endDate: addDays(nextFirst, 19), rateType: 'DAILY', rateAmount: '3500.00', payRateType: 'DAILY', payRateAmount: '2500.00', ...extra,
        })
        .expect(201);
      // Billed in advance, a booking is confirmed once its first invoice is paid. These cases are about the billing
      // that follows confirmation, so staff confirm without payment; the hold itself has cases of its own below.
      const advance = created.body.billingTiming === 'ADVANCE';
      const booking = (
        await api()
          .post(`/bookings/${created.body.id}/confirm`)
          .set(bearer(staffToken))
          .send(advance ? { withoutPayment: true, reason: 'Agreed with the client by phone' } : {})
          .expect(200)
      ).body as { id: string; reference: string; billingTiming: string; shifts: { id: string; startsAt: string }[] };
      const inMonth = (from: string) => booking.shifts.filter((s) => toColombo(s.startsAt).date.slice(0, 7) === from.slice(0, 7)).length;
      return { cg, client, booking, firstMonth: inMonth(first), secondMonth: inMonth(nextFirst) };
    }
    const money = (shifts: number) => (shifts * 3500).toFixed(2);

    it('Auto: bills the first month at once, each later month a few days before it begins, and nothing twice', async () => {
      await mode('AUTO');
      const made = await aheadBooking();
      const { booking } = made;
      expect(booking.billingTiming).toBe('ADVANCE');
      expect(made.firstMonth).toBeGreaterThan(10);
      expect(made.secondMonth).toBeGreaterThan(10);

      // Well before it starts: the booking's first month is billed, for the work booked.
      const early = at(addDays(first, -40));
      expect(await agent.sweep(early, [booking.id])).toMatchObject({ mode: 'AUTO', considered: 1, decided: 1 });
      let made1 = await invoicesFor(booking.id);
      expect(made1).toHaveLength(1);
      expect(made1[0]).toMatchObject({ status: 'ISSUED', basis: 'SCHEDULED', subtotal: money(made.firstMonth), periodStart: addDays(first, 9), periodEnd: addDays(nextFirst, -1) });
      const [decision] = await decisionsFor(booking.id);
      expect(decision).toMatchObject({ action: 'billing.issue_invoice', outcome: 'EXECUTED', executionError: null });
      expect(decision.reason).toBe(`${made.firstMonth} booked, unbilled lines for ${addDays(first, 9)} to ${addDays(nextFirst, -1)}, billed in advance: LKR ${(made.firstMonth * 3500).toLocaleString('en-LK', { minimumFractionDigits: 2 })} before tax`);
      expect((await panel(booking.id)).handoverNote.done).toBe(`Invoice ${made1[0].number} issued in advance for ${addDays(first, 9)} to ${addDays(nextFirst, -1)}`);
      // The client sees it like any other invoice.
      const mine = (await api().get('/me/invoices').set(bearer(made.client.token)).expect(200)).body as { number: string }[];
      expect(mine.some((i) => i.number === made1[0].number)).toBe(true);

      // Looking again, and up to six days before the next month: nothing more.
      await agent.sweep(early, [booking.id]);
      await agent.sweep(at(addDays(nextFirst, -6)), [booking.id]);
      expect(await invoicesFor(booking.id)).toHaveLength(1);

      // Five days before: the next month, up to the booking's last day.
      expect(await agent.sweep(at(addDays(nextFirst, -5)), [booking.id])).toMatchObject({ decided: 1 });
      made1 = (await invoicesFor(booking.id)).sort((a, b) => a.periodStart!.localeCompare(b.periodStart!));
      expect(made1).toHaveLength(2);
      expect(made1[1]).toMatchObject({ status: 'ISSUED', basis: 'SCHEDULED', subtotal: money(made.secondMonth), periodStart: nextFirst, periodEnd: addDays(nextFirst, 19) });

      // Every shift is on exactly one invoice, and later passes find nothing left.
      const lines = (await api().get(`/invoices/${made1[0].id}`).set(bearer(staffToken)).expect(200)).body.lines.length + (await api().get(`/invoices/${made1[1].id}`).set(bearer(staffToken)).expect(200)).body.lines.length;
      expect(lines).toBe(booking.shifts.length);
      await agent.sweep(at(addDays(nextFirst, 3)), [booking.id]);
      await agent.sweep(at(addDays(nextFirst, 40)), [booking.id]);
      expect(await invoicesFor(booking.id)).toHaveLength(2);
      expect(await decisionsFor(booking.id)).toHaveLength(2);
    });

    it('bills each month as many days ahead as Settings > Billing says', async () => {
      await mode('AUTO');
      const settings = (body: object) => api().patch('/settings/billing').set(bearer(adminToken)).send(body);
      expect((await api().get('/settings/billing').set(bearer(adminToken)).expect(200)).body.advanceLeadDays).toBe(5);
      for (const bad of [0, 29, 2.5]) await settings({ advanceLeadDays: bad }).expect(400);
      try {
        expect((await settings({ advanceLeadDays: 12 }).expect(200)).body.advanceLeadDays).toBe(12);
        expect((await api().get('/bookings/defaults').set(bearer(staffToken)).expect(200)).body).toMatchObject({ advanceLeadDays: 12 });
        const made = await aheadBooking();
        await agent.sweep(at(addDays(first, -3)), [made.booking.id]);
        expect(await invoicesFor(made.booking.id)).toHaveLength(1);
        // Thirteen days before the next month: not yet. Twelve: billed.
        await agent.sweep(at(addDays(nextFirst, -13)), [made.booking.id]);
        expect(await invoicesFor(made.booking.id)).toHaveLength(1);
        await agent.sweep(at(addDays(nextFirst, -12)), [made.booking.id]);
        const both = await invoicesFor(made.booking.id);
        expect(both).toHaveLength(2);
        expect(both.some((i) => i.periodStart === nextFirst)).toBe(true);
      } finally {
        await settings({ advanceLeadDays: 5 }).expect(200);
      }
    });

    it('leaves a booking billed after the work alone until the work is done', async () => {
      await mode('AUTO');
      const made = await aheadBooking({});
      expect(made.booking.billingTiming).toBe('AFTER');
      expect(await agent.sweep(at(addDays(first, 12)), [made.booking.id])).toMatchObject({ considered: 0, decided: 0 });
      expect(await decisionsFor(made.booking.id)).toHaveLength(0);
      expect(await invoicesFor(made.booking.id)).toHaveLength(0);
    });

    it('Assist proposes the advance invoice for a staff member to approve; Shadow logs it and scores itself', async () => {
      await mode('ASSIST');
      const made = await aheadBooking();
      const today = at(addDays(first, -3));
      await agent.sweep(today, [made.booking.id]);
      const [proposal] = await decisionsFor(made.booking.id);
      expect(proposal).toMatchObject({ outcome: 'PROPOSED' });
      expect(proposal.proposal).toMatchObject({ basis: 'SCHEDULED', lines: made.firstMonth, subtotalCents: made.firstMonth * 350000 });
      expect(await invoicesFor(made.booking.id)).toHaveLength(0);
      expect((await panel(made.booking.id)).handoverNote.done).toContain('Worked out an advance invoice');
      await agent.sweep(today, [made.booking.id]);
      expect(await decisionsFor(made.booking.id)).toHaveLength(1);
      const approved = (await api().post(`/automation/decisions/${proposal.id}/approve`).set(bearer(staffToken)).expect(200)).body;
      expect(approved).toMatchObject({ staffVerdict: 'AGREED', executionError: null });
      const [inv] = await invoicesFor(made.booking.id);
      expect(inv).toMatchObject({ status: 'ISSUED', basis: 'SCHEDULED', subtotal: money(made.firstMonth) });
      const [staff] = await db.select().from(users).where(eq(users.email, 'staff@care-platform.local'));
      expect(inv.issuedByUserId).toBe(staff.id);

      await mode('SHADOW');
      const other = await aheadBooking();
      await agent.sweep(today, [other.booking.id]);
      const [logged] = await decisionsFor(other.booking.id);
      expect(logged).toMatchObject({ outcome: 'SHADOW', staffVerdict: null });
      expect(await invoicesFor(other.booking.id)).toHaveLength(0);
      // Staff bill the same month in advance by hand: the agent agrees with them.
      const draft = await api().post('/invoices').set(bearer(staffToken)).send({ bookingId: other.booking.id, basis: 'SCHEDULED', periodStart: addDays(first, 9), periodEnd: addDays(nextFirst, -1) }).expect(201);
      await api().post(`/invoices/${draft.body.id}/issue`).set(bearer(staffToken)).send({ notify: false }).expect(200);
      expect((await agent.sweep(today, [other.booking.id])).scored).toBe(1);
      expect((await decisionsFor(other.booking.id))[0]).toMatchObject({ staffVerdict: 'AGREED' });
    });

    it('a shift with no price goes to staff, with the reason', async () => {
      await mode('AUTO');
      const made = await aheadBooking({ billingTiming: 'ADVANCE', rateType: undefined, rateAmount: undefined });
      expect(await agent.sweep(at(addDays(first, -3)), [made.booking.id])).toMatchObject({ decided: 0, leftToStaff: 1 });
      expect(await invoicesFor(made.booking.id)).toHaveLength(0);
      expect((await panel(made.booking.id)).handoverNote.waiting).toBe(`Staff: ${made.firstMonth} shifts have no client rate`);
    });

    it('new bookings take the default from Settings; confirming one billed in advance bills it straight away', async () => {
      await mode('AUTO');
      const settings = (body: object) => api().patch('/settings/billing').set(bearer(adminToken)).send(body);
      expect((await api().get('/settings/billing').set(bearer(adminToken)).expect(200)).body.defaultBillingTiming).toBe('AFTER');
      await settings({ defaultBillingTiming: 'SOMETIMES' }).expect(400);
      let made: Awaited<ReturnType<typeof aheadBooking>>;
      try {
        expect((await settings({ defaultBillingTiming: 'ADVANCE' }).expect(200)).body.defaultBillingTiming).toBe('ADVANCE');
        // Nothing chosen on the booking: it takes the default. Confirming it queues the billing agent.
        made = await aheadBooking({});
      } finally {
        await settings({ defaultBillingTiming: 'AFTER' }).expect(200);
      }
      expect(made.booking.billingTiming).toBe('ADVANCE');
      expect(await invoicesFor(made.booking.id)).toHaveLength(0);
      await app.get(JobsService).runDue(new Date(), [BILLING_BOOKING_JOB]);
      const [inv] = await invoicesFor(made.booking.id);
      expect(inv).toMatchObject({ status: 'ISSUED', basis: 'SCHEDULED', subtotal: money(made.firstMonth) });

      // Staff can change it on the booking; what is already invoiced stays, and nothing more goes out in advance.
      const changed = (await api().patch(`/bookings/${made.booking.id}`).set(bearer(staffToken)).send({ billingTiming: 'AFTER' }).expect(200)).body;
      expect(changed.billingTiming).toBe('AFTER');
      expect(changed.events.some((e: { note: string | null }) => e.note === 'billed after the work from now on')).toBe(true);
      await agent.sweep(at(addDays(nextFirst, -2)), [made.booking.id]);
      expect(await invoicesFor(made.booking.id)).toHaveLength(1);
      // And back: the next month is then due.
      await api().patch(`/bookings/${made.booking.id}`).set(bearer(staffToken)).send({ billingTiming: 'ADVANCE' }).expect(200);
      await api().patch(`/bookings/${made.booking.id}`).set(bearer(staffToken)).send({ billingTiming: 'WHENEVER' }).expect(400);
      await agent.sweep(at(addDays(nextFirst, -2)), [made.booking.id]);
      expect(await invoicesFor(made.booking.id)).toHaveLength(2);
    });
  });

  describe('payment before confirmation (billed in advance)', () => {
    const first = monthStart(addDays(colomboToday(), 520));
    const nextFirst = monthStart(addDays(first, 35));

    /** A draft Mon-Fri booking billed in advance, from the 10th of a month well ahead, that the client has accepted. */
    async function acceptedDraft() {
      const cg = await newCaregiver();
      const client = await newClient();
      const created = (
        await api()
          .post('/bookings')
          .set(bearer(staffToken))
          .send({
            patientId: client.patientId, caregiverId: cg.id, scheduleType: 'DAY', daysOfWeek: [1, 2, 3, 4, 5], shiftStartTime: '08:00', shiftEndTime: '17:00',
            startDate: addDays(first, 9), endDate: addDays(nextFirst, 19), rateType: 'DAILY', rateAmount: '3500.00', payRateType: 'DAILY', payRateAmount: '2500.00', billingTiming: 'ADVANCE',
          })
          .expect(201)
      ).body as { id: string; reference: string; shifts: { startsAt: string }[] };
      await api().post(`/bookings/${created.id}/ask-client`).set(bearer(staffToken)).expect(200);
      await api().post(`/me/booking-proposals/${created.id}/accept`).set(bearer(client.token)).expect(200);
      const firstMonth = created.shifts.filter((s) => toColombo(s.startsAt).date.slice(0, 7) === first.slice(0, 7)).length;
      return { id: created.id, reference: created.reference, client, firstMonth };
    }
    const detail = async (id: string) => (await api().get(`/bookings/${id}`).set(bearer(staffToken)).expect(200)).body;
    const confirm = (id: string, body: object = {}) => api().post(`/bookings/${id}/confirm`).set(bearer(staffToken)).send(body);
    const payInFull = async (invoiceId: string) => {
      const inv = (await api().get(`/invoices/${invoiceId}`).set(bearer(staffToken)).expect(200)).body as { balance: string };
      return api().post(`/invoices/${invoiceId}/payments`).set(bearer(staffToken)).send({ paymentType: 'CASH', paidOn: colomboToday(), notify: false, amount: inv.balance }).expect(201);
    };
    const advance = () => app.get(AdvancePaymentService);
    const emailsLabelled = (prefix: string) => sendEmail.mock.calls.filter((c) => String(c[2]).startsWith(prefix));
    let sendEmail: jest.SpyInstance;
    beforeEach(() => {
      sendEmail = jest.spyOn(app.get(EmailService), 'sendNotificationEmail').mockResolvedValue();
    });
    afterEach(() => sendEmail.mockRestore());

    it('by hand: will not confirm until the first invoice is paid; staff send the invoice, the payment frees it, and staff are told', async () => {
      await mode('MANUAL');
      const b = await acceptedDraft();
      expect((await detail(b.id)).advancePayment).toEqual({ required: true, state: 'NOT_BILLED', invoice: null });

      // Not billed yet: confirming is refused, and says what to do.
      expect((await confirm(b.id).expect(409)).body.message).toBe('This booking is billed in advance and its first invoice has not been sent. Send the invoice, or confirm without payment');

      // Staff send the first invoice: the first month, for the work booked, issued to the client.
      const sent = (await api().post(`/bookings/${b.id}/advance-invoice`).set(bearer(staffToken)).expect(201)).body as { id: string; number: string; status: string; basis: string; subtotal: string; periodStart: string; periodEnd: string };
      expect(sent).toMatchObject({ status: 'ISSUED', basis: 'SCHEDULED', subtotal: (b.firstMonth * 3500).toFixed(2), periodStart: addDays(first, 9), periodEnd: addDays(nextFirst, -1) });
      await api().post(`/bookings/${b.id}/advance-invoice`).set(bearer(staffToken)).expect(409);
      const mine = (await api().get('/me/invoices').set(bearer(b.client.token)).expect(200)).body as { number: string }[];
      expect(mine.some((i) => i.number === sent.number)).toBe(true);

      // The client's card carries it, with what to pay, so they can pay it from there.
      const [card] = (await api().get('/me/booking-proposals').set(bearer(b.client.token)).expect(200)).body as { firstInvoice: Record<string, unknown> | null }[];
      expect(card.firstInvoice).toMatchObject({ id: sent.id, number: sent.number, balance: sent.subtotal, canPayOnline: expect.any(Boolean) });

      // Sent and not paid: still refused. The shifts are still drafts, so no caregiver is booked.
      expect((await detail(b.id)).advancePayment).toMatchObject({ state: 'UNPAID', invoice: { id: sent.id, number: sent.number, status: 'ISSUED' } });
      expect((await confirm(b.id).expect(409)).body.message).toBe('This booking is billed in advance and its first invoice has not been paid. Confirm without payment only if you have agreed that with the client');
      expect((await bookingRow(b.id)).status).toBe('DRAFT');
      // Its shifts cannot be dropped from under the invoice, and the draft cannot be thrown away while it is out.
      expect((await api().post(`/bookings/${b.id}/cancel`).set(bearer(staffToken)).send({ reason: 'Client changed their mind' }).expect(409)).body.message).toBe('This booking has its first invoice out - void the invoice first');

      // Paid in full: staff are told it can be confirmed, and then it can.
      await payInFull(sent.id);
      await app.get(JobsService).runDue(new Date(), [INVOICE_PAID_JOB]);
      const told = emailsLabelled(`advance paid ${sent.id}`);
      expect(told).toHaveLength(1);
      expect((told[0][1] as { subject: string }).subject).toBe(`Paid, ready to confirm: ${b.reference}`);
      expect((await detail(b.id)).advancePayment).toMatchObject({ required: true, state: 'PAID' });
      const confirmed = (await confirm(b.id).expect(200)).body;
      expect(confirmed).toMatchObject({ status: 'CONFIRMED', advancePayment: { required: false, state: 'PAID' } });
      // The shifts it billed stay on that invoice: the billing agent does not bill them again.
      await mode('AUTO');
      await agent.sweep(new Date(`${addDays(first, 12)}T06:00:00Z`), [b.id]);
      expect((await invoicesFor(b.id)).filter((i) => i.periodStart === addDays(first, 9))).toHaveLength(1);
    });

    it('staff can confirm without payment, with a reason that stays in the history', async () => {
      await mode('MANUAL');
      const b = await acceptedDraft();
      await confirm(b.id, { withoutPayment: true }).expect(400);
      await confirm(b.id, { withoutPayment: true, reason: '  ' }).expect(400);
      const done = (await confirm(b.id, { withoutPayment: true, reason: 'Client pays by bank transfer on Friday' }).expect(200)).body as { status: string; events: { type: string; note: string | null }[] };
      expect(done.status).toBe('CONFIRMED');
      expect(done.events.find((e) => e.type === 'CONFIRMED')?.note).toContain('confirmed without payment: Client pays by bank transfer on Friday');
    });

    it('alerts staff once when the first invoice is overdue or the booking is about to start, and not before', async () => {
      await mode('MANUAL');
      const b = await acceptedDraft();
      const inv = (await api().post(`/bookings/${b.id}/advance-invoice`).set(bearer(staffToken)).expect(201)).body as { id: string; number: string; dueDate: string };
      // Before it is due and well before the booking starts: nothing.
      expect(await advance().alertUnpaid(new Date(`${inv.dueDate}T06:00:00Z`), [b.id])).toBe(0);
      // The day after it was due: one email, and a line in the booking's history.
      const late = new Date(`${addDays(inv.dueDate, 1)}T06:00:00Z`);
      expect(await advance().alertUnpaid(late, [b.id])).toBe(1);
      const mail = emailsLabelled(`advance unpaid ${inv.id}`);
      expect(mail).toHaveLength(1);
      expect((mail[0][1] as { subject: string }).subject).toBe(`Not paid, not confirmed: ${b.reference}`);
      expect(JSON.stringify(mail[0][1])).toContain(`invoice ${inv.number} was due on ${inv.dueDate}`);
      expect(((await detail(b.id)).events as { note: string | null }[]).some((e) => e.note?.startsWith('Staff alerted: the first invoice is not paid'))).toBe(true);
      // Once only, even as it gets closer to the start.
      expect(await advance().alertUnpaid(new Date(`${addDays(first, 8)}T06:00:00Z`), [b.id])).toBe(0);
      expect(emailsLabelled(`advance unpaid ${inv.id}`)).toHaveLength(1);
      // Counted on the dashboard's Needs attention.
      const insights = (await api().get('/insights/overview').set(bearer(adminToken)).expect(200)).body;
      expect(insights.attention.awaitingPayment).toBeGreaterThanOrEqual(1);
    });

    it('with the agents on: the invoice goes out when the client accepts, and the booking is confirmed once it is paid', async () => {
      await mode('AUTO');
      await api().patch('/settings/automation/functions/BOOKING').set(bearer(adminToken)).send({ mode: 'AUTO' }).expect(200);
      await api().patch('/settings/automation/actions/booking.confirm').set(bearer(adminToken)).send({ autoAllowed: true });
      try {
        const b = await acceptedDraft();
        // Accepting queued the billing agent: it sends the first month, and nothing more while it is a draft.
        await app.get(JobsService).runDue(new Date(), [BILLING_BOOKING_JOB]);
        const [inv] = await invoicesFor(b.id);
        expect(inv).toMatchObject({ status: 'ISSUED', basis: 'SCHEDULED', subtotal: (b.firstMonth * 3500).toFixed(2) });
        await agent.sweep(new Date(`${addDays(nextFirst, -3)}T06:00:00Z`), [b.id]);
        expect(await invoicesFor(b.id)).toHaveLength(1);

        // The booking agent waits for the payment.
        await app.get(BookingAgentService).answers(new Date(), [b.id]);
        expect((await bookingRow(b.id)).status).toBe('DRAFT');
        expect((await panel(b.id)).handoverNote).toMatchObject({ waiting: `The client to pay invoice ${inv.number}` });

        // Paid: staff are told, and the booking agent confirms it (or proposes it, if it has not earned that yet).
        await payInFull(inv.id);
        await app.get(JobsService).runDue(new Date(), [INVOICE_PAID_JOB]);
        await app.get(BookingAgentService).answers(new Date(), [b.id]);
        const [decision] = (await decisionsFor(b.id)).filter((d) => d.action === 'booking.confirm');
        expect(decision).toBeDefined();
        expect(['EXECUTED', 'PROPOSED']).toContain(decision.outcome);
      } finally {
        await api().patch('/settings/automation/functions/BOOKING').set(bearer(adminToken)).send({ mode: 'MANUAL' }).expect(200);
      }
    });
  });

  describe('visits paused for an unpaid month (billed in advance)', () => {
    const first = monthStart(addDays(colomboToday(), 610));
    const nextFirst = monthStart(addDays(first, 35));
    let notify: jest.SpyInstance;
    let sendEmail: jest.SpyInstance;
    beforeEach(() => {
      notify = jest.spyOn(app.get(NotificationsService), 'notify');
      sendEmail = jest.spyOn(app.get(EmailService), 'sendNotificationEmail').mockResolvedValue();
    });
    afterEach(() => {
      notify.mockRestore();
      sendEmail.mockRestore();
    });

    /** A confirmed booking billed in advance, its first month invoiced by staff, and that invoice past its due date. */
    async function overdueBooking() {
      const cg = await newCaregiver();
      const client = await newClient();
      const created = (
        await api()
          .post('/bookings')
          .set(bearer(staffToken))
          .send({
            patientId: client.patientId, caregiverId: cg.id, scheduleType: 'DAY', daysOfWeek: [1, 2, 3, 4, 5], shiftStartTime: '08:00', shiftEndTime: '17:00',
            startDate: addDays(first, 9), endDate: addDays(nextFirst, 19), rateType: 'DAILY', rateAmount: '3500.00', payRateType: 'DAILY', payRateAmount: '2500.00', billingTiming: 'ADVANCE',
          })
          .expect(201)
      ).body as { id: string; reference: string };
      await api().post(`/bookings/${created.id}/confirm`).set(bearer(staffToken)).send({ withoutPayment: true, reason: 'Paying on the first visit' }).expect(200);
      // A later month's invoice, issued and now past due (moved back in the database instead of waiting for it).
      const draft = await api().post('/invoices').set(bearer(staffToken)).send({ bookingId: created.id, basis: 'SCHEDULED', periodStart: nextFirst, periodEnd: addDays(nextFirst, 19) }).expect(201);
      const inv = (await api().post(`/invoices/${draft.body.id}/issue`).set(bearer(staffToken)).send({ notify: false }).expect(200)).body as { id: string; number: string; total: string };
      const due = addDays(colomboToday(), -1);
      await db.update(invoices).set({ dueDate: due }).where(eq(invoices.id, inv.id));
      const cgUser = (await db.select({ userId: caregivers.userId }).from(caregivers).where(eq(caregivers.id, cg.id)))[0].userId;
      return { id: created.id, reference: created.reference, cg, cgUser, client, inv, due };
    }
    const booking = async (id: string) => (await api().get(`/bookings/${id}`).set(bearer(staffToken)).expect(200)).body;
    const told = (label: string) => notify.mock.calls.filter((c) => c[3] === label);
    const hold = () => app.get(AdvancePaymentService);

    it('pauses visits when a later month is past due unpaid, tells everyone, and resumes them when it is paid', async () => {
      const b = await overdueBooking();
      // Not before the due date has passed.
      expect(await hold().holdUnpaid(new Date(`${addDays(b.due, -2)}T06:00:00Z`), [b.id])).toBe(0);
      expect(await hold().holdUnpaid(new Date(), [b.id])).toBe(1);
      expect(await hold().holdUnpaid(new Date(), [b.id])).toBe(0);

      const paused = await booking(b.id);
      expect(paused.paymentHold).toMatchObject({ invoiceId: b.inv.id, invoiceNumber: b.inv.number, dueDate: b.due, balance: b.inv.total });
      expect(paused.events.some((e: { note: string | null }) => e.note === `Visits paused: invoice ${b.inv.number} was due on ${b.due} and is not paid`)).toBe(true);
      // Staff are emailed; the caregiver is told not to go, without the reason; the client is told what to pay, and can pay it.
      expect(sendEmail.mock.calls.filter((c) => c[2] === `visits paused ${b.inv.id}`)).toHaveLength(1);
      const toCaregiver = told(`visits paused ${b.id}`).find((c) => (c[0] as (string | null)[]).includes(b.cgUser))!;
      const words = (toCaregiver[1] as (l: 'en') => { title: string; body: string })('en');
      expect(words).toEqual({ title: 'Visits paused', body: `The office has paused the visits for booking ${b.reference}. Do not go until you hear they are back on.` });
      expect(JSON.stringify(words)).not.toMatch(/invoice|pay/i);
      expect(told(`visits paused ${b.id}`).some((c) => c[2] === `/invoices/${b.inv.id}`)).toBe(true);
      const shifts = (await api().get('/me/shifts').set(bearer(b.cg.token)).expect(200)).body as { bookingReference: string; paused: boolean }[];
      expect(shifts.filter((s) => s.bookingReference === b.reference).every((s) => s.paused)).toBe(true);
      const mine = ((await api().get('/me/bookings').set(bearer(b.client.token)).expect(200)).body as { id: string; paymentHold: Record<string, unknown> | null }[]).find((x) => x.id === b.id)!;
      expect(mine.paymentHold).toMatchObject({ id: b.inv.id, number: b.inv.number, balance: b.inv.total, canPayOnline: expect.any(Boolean) });
      // No further month is billed while paused.
      await mode('AUTO');
      await agent.sweep(new Date(`${addDays(nextFirst, 25)}T06:00:00Z`), [b.id]);
      expect((await invoicesFor(b.id)).length).toBe(1);

      // Paid: visits resume and everyone is told.
      await api().post(`/invoices/${b.inv.id}/payments`).set(bearer(staffToken)).send({ paymentType: 'CASH', paidOn: colomboToday(), notify: false, amount: b.inv.total }).expect(201);
      await app.get(JobsService).runDue(new Date(), [INVOICE_PAID_JOB]);
      expect((await booking(b.id)).paymentHold).toBeNull();
      expect(told(`visits resumed ${b.id}`).length).toBeGreaterThanOrEqual(2);
      expect(sendEmail.mock.calls.filter((c) => c[2] === `visits resumed ${b.inv.id}`)).toHaveLength(1);
      const after = (await api().get('/me/shifts').set(bearer(b.cg.token)).expect(200)).body as { bookingReference: string; paused: boolean }[];
      expect(after.filter((s) => s.bookingReference === b.reference).some((s) => s.paused)).toBe(false);
    });

    it('staff can resume visits without payment, with a reason; that invoice never pauses them again', async () => {
      const b = await overdueBooking();
      await hold().holdUnpaid(new Date(), [b.id]);
      await api().post(`/bookings/${b.id}/resume-visits`).set(bearer(staffToken)).send({}).expect(400);
      const resumed = (await api().post(`/bookings/${b.id}/resume-visits`).set(bearer(staffToken)).send({ reason: 'Daughter paying in cash tomorrow' }).expect(200)).body;
      expect(resumed.paymentHold).toBeNull();
      expect(resumed.events.some((e: { note: string | null }) => e.note === 'Visits resumed without payment: Daughter paying in cash tomorrow')).toBe(true);
      await api().post(`/bookings/${b.id}/resume-visits`).set(bearer(staffToken)).send({ reason: 'Again' }).expect(400);
      expect(await hold().holdUnpaid(new Date(), [b.id])).toBe(0);
      // A caregiver cannot be refused at the door by a pause that was lifted.
      expect((await booking(b.id)).paymentHold).toBeNull();
    });

    it('does not pause a booking billed after the work, or the first invoice staff confirmed without', async () => {
      const b = await overdueBooking();
      await api().patch(`/bookings/${b.id}`).set(bearer(staffToken)).send({ billingTiming: 'AFTER' }).expect(200);
      expect(await hold().holdUnpaid(new Date(), [b.id])).toBe(0);
    });
  });

  describe('caregiver pay statements', () => {
    const HOURS = 3_600_000;
    const later = () => new Date(Date.now() + 2 * HOURS);
    const statementsFor = (caregiverId: string) => db.select().from(payoutStatements).where(eq(payoutStatements.caregiverId, caregiverId));
    const payDecisions = async (caregiverId: string, action: string) =>
      (await db.select().from(agentDecisions).where(eq(agentDecisions.action, action)).orderBy(agentDecisions.createdAt)).filter(
        (d) => (d.proposal as { caregiverId?: string } | null)?.caregiverId === caregiverId,
      );
    const paySweep = (when: Date, ...made: { cg: { id: string } }[]) => agent.sweepPayouts(when, undefined, made.map((m) => m.cg.id));
    const policy = (body: object) => api().patch('/settings/automation/actions/billing.approve_payout').set(bearer(adminToken)).send(body);

    /** A caregiver who worked five days last month (or earlier) at LKR 2,500 a day = LKR 12,500, none of it on a statement. */
    async function workedLastMonth() {
      const lastMonthEnd = endOfPreviousMonth(colomboToday());
      let weeks = 1;
      while (addDays(mondayWeeksAgo(weeks), 4) > lastMonthEnd) weeks++;
      const made = await pastBooking(weeks);
      for (const s of made.booking.shifts) await setShift(made.booking.id, s.id, { status: 'COMPLETED' });
      return { ...made, lastMonthEnd, monthOf: `${made.monday.slice(0, 8)}01` };
    }

    beforeEach(async () => {
      await db.execute(sql`DELETE FROM automation_action_policies WHERE action = 'billing.approve_payout'`);
      await api().patch('/settings/automation').set(bearer(adminToken)).send({ cases: 50, agreementPercent: 90, demoteAfterReversals: 3 }).expect(200);
    });

    it('Shadow: logs the draft and the approval it would make, and scores both against staff', async () => {
      await mode('SHADOW');
      const w = await workedLastMonth();
      expect(await paySweep(new Date(), w)).toMatchObject({ mode: 'SHADOW', considered: 1, decided: 1 });
      const [draft] = await payDecisions(w.cg.id, 'billing.draft_payout');
      expect(draft).toMatchObject({ outcome: 'SHADOW', tier: 1, caseType: null });
      expect(draft.proposal).toMatchObject({ periodStart: w.monthOf, periodEnd: w.lastMonthEnd, lines: 5, unpriced: 0, totalCents: 1_250_000 });
      expect(await statementsFor(w.cg.id)).toHaveLength(0);
      expect((await paySweep(new Date(), w)).decided).toBe(0);

      // Staff make the statement themselves. Fresh from their hands it is left alone; an hour on, the agent looks at it.
      const made = (await api().post('/payouts').set(bearer(staffToken)).send({ caregiverId: w.cg.id, periodStart: w.monthOf, periodEnd: w.lastMonthEnd }).expect(201)).body;
      const soon = await paySweep(new Date(), w);
      expect(soon).toMatchObject({ scored: 1, decided: 0 });
      expect((await payDecisions(w.cg.id, 'billing.draft_payout'))[0]).toMatchObject({ staffVerdict: 'AGREED' });
      expect((await paySweep(later(), w)).decided).toBe(1);
      const [approval] = await payDecisions(w.cg.id, 'billing.approve_payout');
      expect(approval).toMatchObject({ outcome: 'SHADOW', tier: 2, caseType: 'PAYOUT', caseId: made.id });
      expect(approval.reason).toMatch(/every shift priced, LKR 12,500\.00 is within the limit of LKR 50,000\.00/);
      expect((await statementsFor(w.cg.id))[0].status).toBe('DRAFT');

      await api().post(`/payouts/${made.id}/approve`).set(bearer(staffToken)).expect(200);
      expect((await paySweep(later(), w)).scored).toBe(1);
      const [scored] = await payDecisions(w.cg.id, 'billing.approve_payout');
      expect(scored).toMatchObject({ staffVerdict: 'AGREED', staffNote: 'Scored automatically: staff approved it unchanged' });
    });

    it('Assist: staff approve the draft, then the approval, each carried out under their name', async () => {
      await mode('ASSIST');
      const w = await workedLastMonth();
      await paySweep(new Date(), w);
      const [draft] = await payDecisions(w.cg.id, 'billing.draft_payout');
      expect(draft).toMatchObject({ outcome: 'PROPOSED' });
      expect(await statementsFor(w.cg.id)).toHaveLength(0);

      const drafted = (await api().post(`/automation/decisions/${draft.id}/approve`).set(bearer(staffToken)).expect(200)).body;
      const [statement] = await statementsFor(w.cg.id);
      expect(statement).toMatchObject({ status: 'DRAFT', total: '12500.00', periodStart: w.monthOf, periodEnd: w.lastMonthEnd });
      expect(drafted.result).toMatchObject({ payoutId: statement.id, reference: statement.reference });
      const onPage = (await api().get(`/automation/cases/PAYOUT/${statement.id}`).set(bearer(staffToken)).expect(200)).body;
      expect(onPage.handoverNote.done).toContain(statement.reference);

      // Nothing is drafted twice, and the approval is proposed once the draft has settled.
      expect((await paySweep(new Date(), w)).decided).toBe(0);
      await paySweep(later(), w);
      const [approval] = await payDecisions(w.cg.id, 'billing.approve_payout');
      expect(approval).toMatchObject({ outcome: 'PROPOSED', caseId: statement.id });
      await api().post(`/automation/decisions/${approval.id}/approve`).set(bearer(staffToken)).expect(200);
      const [staff] = await db.select().from(users).where(eq(users.email, 'staff@care-platform.local'));
      expect((await statementsFor(w.cg.id))[0]).toMatchObject({ status: 'APPROVED', approvedByUserId: staff.id });
      expect(await statementsFor(w.cg.id)).toHaveLength(1);
    });

    it('Auto: drafts alone, but approves alone only once that has been earned, and never over the limit', async () => {
      await mode('AUTO');
      // Earning is counted from the record; start it fresh so earlier runs on the same database do not count.
      await policy({ resetRecord: true }).expect(200);
      const first = await workedLastMonth();
      await paySweep(new Date(), first);
      const [agentUser] = await db.select().from(users).where(eq(users.email, 'billing-agent@agents.invalid'));
      let [s1] = await statementsFor(first.cg.id);
      expect(s1).toMatchObject({ status: 'DRAFT', total: '12500.00', createdByUserId: agentUser.id });
      // Its own draft needs no settling time - but approving is a commitment it has not earned: it asks.
      const [asked] = await payDecisions(first.cg.id, 'billing.approve_payout');
      expect(asked).toMatchObject({ outcome: 'PROPOSED', mode: 'AUTO' });

      // Earn it: ten approvals staff agree with, at a bar of ten.
      await api().patch('/settings/automation').set(bearer(adminToken)).send({ cases: 10 }).expect(200);
      await policy({ autoAllowed: true }).expect(400);
      await api().post(`/automation/decisions/${asked.id}/approve`).set(bearer(staffToken)).expect(200);
      for (let i = 0; i < 9; i++) {
        const d = await automation.decide({ action: 'billing.approve_payout', reason: 'Statement within the limit' });
        await api().post(`/automation/decisions/${d.decisionId}/review`).set(bearer(staffToken)).send({ verdict: 'AGREED' }).expect(200);
      }
      await policy({ autoAllowed: true }).expect(200);

      const second = await workedLastMonth();
      await paySweep(new Date(), second);
      const [s2] = await statementsFor(second.cg.id);
      expect(s2).toMatchObject({ status: 'APPROVED', approvedByUserId: agentUser.id });
      expect((await payDecisions(second.cg.id, 'billing.approve_payout'))[0]).toMatchObject({ outcome: 'EXECUTED', executionError: null });
      // Paying is never the agent's: the statement waits for staff.
      expect(s2.paidAt ?? null).toBeNull();

      // A limit of LKR 10,000: a LKR 12,500 statement is drafted and left for staff, with the reason.
      const over = (await policy({ limits: { maxAmount: 10000 } }).expect(200)).body;
      expect(over.functions.flatMap((f: { actions: { key: string; limits: unknown }[] }) => f.actions).find((a: { key: string }) => a.key === 'billing.approve_payout').limits).toEqual({ maxAmount: 10000 });
      const third = await workedLastMonth();
      const run = await paySweep(new Date(), third);
      expect(run.leftToStaff).toBe(1);
      const [s3] = await statementsFor(third.cg.id);
      expect(s3.status).toBe('DRAFT');
      expect(await payDecisions(third.cg.id, 'billing.approve_payout')).toHaveLength(0);
      const note = (await api().get(`/automation/cases/PAYOUT/${s3.id}`).set(bearer(staffToken)).expect(200)).body.handoverNote;
      expect(note.waiting).toBe("Staff: LKR 12,500.00 is over the agent's limit of LKR 10,000.00");
      s1 = (await statementsFor(first.cg.id))[0];
      expect(s1.status).toBe('APPROVED');
    });
  });

  it('"Run now" runs the billing agent, and every agent is built now', async () => {
    await mode('SHADOW');
    const ran = await api().post('/settings/automation/functions/BILLING/run').set(bearer(adminToken)).expect(200);
    expect(ran.body).toMatchObject({ function: 'BILLING', mode: 'SHADOW' });
    expect((await api().post('/settings/automation/functions/ONBOARDING/run').set(bearer(adminToken)).expect(200)).body).toMatchObject({ function: 'ONBOARDING' });
    await api().post('/settings/automation/functions/BILLING/run').set(bearer(staffToken)).expect(403);
    void automation;
    // "Run now" goes through every booking in the database, not just this suite's: allow for a full one.
  }, 60_000);

  describe('payment reminders', () => {
    let notify: jest.SpyInstance;
    let sendEmail: jest.SpyInstance;
    const REMIND = 'billing.remind_payment';
    const reminders = () => app.get(PaymentRemindersService);
    beforeEach(() => {
      notify = jest.spyOn(app.get(NotificationsService), 'notify');
      sendEmail = jest.spyOn(app.get(EmailService), 'sendNotificationEmail').mockResolvedValue();
    });
    afterEach(() => {
      notify.mockRestore();
      sendEmail.mockRestore();
    });
    /** An issued invoice for finished work, issued yesterday and due in `days`. */
    async function issued(days: number, advance = false) {
      const made = await finishedBooking(3);
      const monday = made.monday;
      const inv = (await billByHand(made.booking.id, monday)) as { id: string; number: string; total: string };
      await db.update(invoices).set({ issueDate: addDays(colomboToday(), -1), dueDate: addDays(colomboToday(), days) }).where(eq(invoices.id, inv.id));
      if (advance) await db.execute(sql`UPDATE bookings SET billing_timing = 'ADVANCE' WHERE id = ${made.booking.id}`);
      return { ...inv, made, due: addDays(colomboToday(), days) };
    }
    const sentFor = (id: string) => notify.mock.calls.filter((c) => String(c[3]).startsWith(`payment reminder ${id} `));
    const words = (call: unknown[]) => (call[1] as (l: 'en') => { title: string; body: string })('en');
    const remindersOf = (id: string) => db.select().from(agentDecisions).where(and(eq(agentDecisions.caseId, id), eq(agentDecisions.action, REMIND))).orderBy(agentDecisions.createdAt);
    const moveDue = (id: string, days: number) => db.update(invoices).set({ dueDate: addDays(colomboToday(), days) }).where(eq(invoices.id, id));

    it('does nothing in Manual', async () => {
      await mode('MANUAL');
      const inv = await issued(2);
      expect(await reminders().sweep(new Date(), [inv.id])).toEqual({ considered: 0, decided: 0, scored: 0 });
      expect(sentFor(inv.id)).toHaveLength(0);
    });

    it('Auto: reminds before, on the day, and once late - each once, in the invoice language', async () => {
      await mode('AUTO');
      const inv = await issued(2);
      expect(await reminders().sweep(new Date(), [inv.id])).toMatchObject({ considered: 1, decided: 1 });
      const [first] = sentFor(inv.id);
      expect(first[0]).toEqual([inv.made.client.userId]);
      expect(first[2]).toBe(`/invoices/${inv.id}`);
      expect(words(first)).toEqual({ title: `Invoice ${inv.number} is due on ${inv.due}`, body: `${formatLkr(inv.total)} is due on ${inv.due}. You can pay it online from the invoice.` });
      // The invoice has the client's email: they get it there too.
      expect(sendEmail.mock.calls.filter((c) => c[2] === `payment reminder ${inv.id} BEFORE`)).toHaveLength(1);
      await reminders().sweep(new Date(), [inv.id]);
      expect(sentFor(inv.id)).toHaveLength(1);

      await moveDue(inv.id, 0);
      await reminders().sweep(new Date(), [inv.id]);
      expect(words(sentFor(inv.id)[1]).title).toBe(`Invoice ${inv.number} is due today`);
      await moveDue(inv.id, -1);
      await reminders().sweep(new Date(), [inv.id]);
      expect(sentFor(inv.id)).toHaveLength(2);
      await moveDue(inv.id, -4);
      await reminders().sweep(new Date(), [inv.id]);
      expect(words(sentFor(inv.id)[2]).title).toBe(`Invoice ${inv.number} is overdue`);
      await reminders().sweep(new Date(), [inv.id]);
      expect(sentFor(inv.id)).toHaveLength(3);
      expect((await remindersOf(inv.id)).map((d) => d.outcome)).toEqual(['EXECUTED', 'EXECUTED', 'EXECUTED']);
    });

    it('tells a client billed in advance that visits pause, and does not remind them once late (the pause does)', async () => {
      await mode('AUTO');
      const inv = await issued(0, true);
      await reminders().sweep(new Date(), [inv.id]);
      expect(words(sentFor(inv.id)[0]).body).toBe(`${formatLkr(inv.total)} is due today. You can pay it online from the invoice. If it is not paid, visits pause from tomorrow until it is.`);
      await moveDue(inv.id, -4);
      await reminders().sweep(new Date(), [inv.id]);
      expect(sentFor(inv.id)).toHaveLength(1);
    });

    it('never reminds about a paid invoice', async () => {
      await mode('AUTO');
      const inv = await issued(1);
      await api().post(`/invoices/${inv.id}/payments`).set(bearer(staffToken)).send({ paymentType: 'CASH', paidOn: colomboToday(), notify: false, amount: inv.total }).expect(201);
      await reminders().sweep(new Date(), [inv.id]);
      expect(sentFor(inv.id)).toHaveLength(0);
    });

    it('Assist proposes; Shadow logs and is scored when the invoice is paid', async () => {
      await mode('ASSIST');
      const a = await issued(2);
      await reminders().sweep(new Date(), [a.id]);
      const [d] = await remindersOf(a.id);
      expect(d).toMatchObject({ outcome: 'PROPOSED' });
      expect(sentFor(a.id)).toHaveLength(0);
      await api().post(`/automation/decisions/${d.id}/approve`).set(bearer(staffToken)).expect(200);
      expect(sentFor(a.id)).toHaveLength(1);

      await mode('SHADOW');
      const b = await issued(2);
      await reminders().sweep(new Date(), [b.id]);
      expect(sentFor(b.id)).toHaveLength(0);
      expect((await remindersOf(b.id))[0]).toMatchObject({ outcome: 'SHADOW', staffVerdict: null });
      await api().post(`/invoices/${b.id}/payments`).set(bearer(staffToken)).send({ paymentType: 'CASH', paidOn: colomboToday(), notify: false, amount: b.total }).expect(201);
      await reminders().sweep(new Date(), [b.id]);
      expect((await remindersOf(b.id))[0]).toMatchObject({ staffVerdict: 'AGREED' });
      await mode('MANUAL');
    });
  });
});
