import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { addDays, colomboToday, isoWeekday } from '@care-platform/shared';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { agentDecisions, caregivers, invoices, patients, payoutStatements, users } from '../src/database/schema';
import { AutomationService } from '../src/automation/automation.service';
import { BillingAgentService, endOfPreviousMonth } from '../src/billing/billing-agent.service';
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
  const mode = (m: string) => api().patch('/settings/automation/functions/BILLING').set(bearer(adminToken)).send({ mode: m }).expect(200);
  const decisionsFor = (bookingId: string) =>
    db.select().from(agentDecisions).where(and(eq(agentDecisions.caseType, 'BOOKING'), eq(agentDecisions.caseId, bookingId))).orderBy(agentDecisions.createdAt);
  const invoicesFor = (bookingId: string) => db.select().from(invoices).where(eq(invoices.bookingId, bookingId));
  /** Sweeps only this suite's bookings: other suites run at the same time and own theirs. */
  const sweep = (...made: { booking: { id: string } }[]) => agent.sweep(new Date(), made.map((m) => m.booking.id));
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

  it('"Run now" runs the billing agent, and says so for agents not built yet', async () => {
    await mode('SHADOW');
    const ran = await api().post('/settings/automation/functions/BILLING/run').set(bearer(adminToken)).expect(200);
    expect(ran.body).toMatchObject({ function: 'BILLING', mode: 'SHADOW' });
    await api().post('/settings/automation/functions/BOOKING/run').set(bearer(adminToken)).expect(400);
    await api().post('/settings/automation/functions/BILLING/run').set(bearer(staffToken)).expect(403);
    void automation;
    // "Run now" goes through every booking in the database, not just this suite's: allow for a full one.
  }, 60_000);
});
