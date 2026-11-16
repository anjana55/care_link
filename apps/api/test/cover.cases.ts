import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { and, eq, isNotNull, like, or } from 'drizzle-orm';
import request from 'supertest';
import { addDays, colomboToday, isoWeekday, toColombo, type CaregiverCareOffer, type CaregiverShift, type ShiftCover, type StaffCheckIn } from '@care-platform/shared';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { agentDecisions, bookingShifts, bookings, caregivers, cities, invoices, patients, preferredLocations, requestOffers } from '../src/database/schema';
import { AutomationService } from '../src/automation/automation.service';
import { LiveCareAgentService } from '../src/bookings/live-care-agent.service';
import { JobsService } from '../src/jobs/jobs.service';
import { COVER_CLOSE_JOB } from '../src/cover/cover-jobs';
import type { CoverProposal } from '../src/cover/cover-agent.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { EmailService } from '../src/email/email.service';
import { WhatsappProviderService } from '../src/whatsapp/whatsapp-provider.service';
import { SEED_PASSWORD } from './seed-password';

/**
 * Cover for a shift whose caregiver cannot come, over real HTTP and MySQL:
 * staff find cover by hand; caregivers see and answer cover offers with their
 * job offers; the first to accept is put on the shift and the right people
 * are told; and the cover part of the live-care agent does the asking when a
 * visit has started with nobody there.
 *
 * Imported by automation.e2e-spec.ts so it runs in the same worker as the
 * other agent cases (they share the automation dials and the check-in
 * switch). It has a district to itself, so nobody else's caregivers are ever
 * suggested; every sweep here names its own shifts.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

describe('Cover for a no-show (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let jwt: JwtService;
  let accessSecret: string;
  let staffToken: string;
  let adminToken: string;
  let agent: LiveCareAgentService;
  let districtId: number;
  let cityId: number;
  let intake: Record<string, unknown>;
  let notify: jest.SpyInstance;
  let sendUpdate: jest.SpyInstance;
  let canSend: jest.SpyInstance;
  let sendEmail: jest.SpyInstance;

  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const run = (Math.floor(Date.now() / 1000) + 4100) % 10_000;
  let n = 0;
  const newPhone = (prefix = '072') => `${prefix}${String(run * 1000 + ++n).padStart(7, '0')}`;
  const minutes = (m: number) => new Date(Date.now() + m * 60_000);
  let weekOffset = 0;
  const freshMonday = () => {
    let d = addDays(colomboToday(), 500 + 21 * weekOffset++);
    while (isoWeekday(d) !== 1) d = addDays(d, 1);
    return d;
  };

  async function caregiver(name: string, inDistrict: boolean) {
    const phone = newPhone();
    const reg = await api()
      .post('/auth/register-caregiver/unified')
      .send({
        phone, consentAccepted: true, fullName: `${name} ${phone}`, permanentAddress: '1 Lake Road, Kandy', dateOfBirth: '1988-01-20', gender: 'FEMALE',
        civilStatus: 'MARRIED', emergencyContactName: 'EC', emergencyContactNumber: '0770001111', emergencyContactRelationship: 'Husband',
      })
      .expect(201);
    const [cg] = await db.select().from(caregivers).where(eq(caregivers.registrationNumber, reg.body.registrationNumber));
    await db.update(caregivers).set({ status: 'ACTIVE', ...(inDistrict ? { districtId, cityId } : {}) }).where(eq(caregivers.id, cg.id));
    return {
      id: cg.id, userId: cg.userId!, reg: cg.registrationNumber, name: `${name} ${phone}`, phone,
      token: jwt.sign({ sub: cg.userId, role: 'CAREGIVER', caregiverId: cg.id }, { secret: accessSecret, expiresIn: '10m' }),
    };
  }
  /** A caregiver who lives where the cover cases' clients do, so the rules can suggest them. */
  const standIn = () => caregiver('Cover Caregiver', true);
  type Person = Awaited<ReturnType<typeof caregiver>>;

  /** A confirmed booking with one four-hour shift that starts `startsIn` minutes from now, paid LKR 2,800 a day, with its own client and caregiver. */
  async function visit(startsIn: number) {
    const booked = await caregiver('Booked Caregiver', false);
    const client = await api()
      .post('/auth/register-patient')
      .send({ email: `cover-client-${run}-${++n}@example.com`, password: 'SelfRegPass123', fullName: 'Nimal Kumara Perera', phone: newPhone('077'), consentAccepted: true, ...intake })
      .expect(201);
    const [patient] = await db.select().from(patients).where(eq(patients.id, client.body.patientId));
    const monday = freshMonday();
    const draft = await api()
      .post('/bookings')
      .set(bearer(staffToken))
      .send({
        patientId: patient.id, caregiverId: booked.id, scheduleType: 'DAY', daysOfWeek: [1], shiftStartTime: '08:00', shiftEndTime: '17:00', startDate: monday, endDate: monday,
        rateType: 'DAILY', rateAmount: '3500', payRateType: 'DAILY', payRateAmount: '2800',
      })
      .expect(201);
    const booking = (await api().post(`/bookings/${draft.body.id}/confirm`).set(bearer(staffToken)).expect(200)).body;
    const shiftId = booking.shifts[0].id as string;
    await db.update(bookingShifts).set({ startsAt: minutes(startsIn), endsAt: minutes(startsIn + 240) }).where(eq(bookingShifts.id, shiftId));
    const [stored] = await db.select().from(bookingShifts).where(eq(bookingShifts.id, shiftId));
    return { id: shiftId, bookingId: booking.id as string, reference: booking.reference as string, booked, patientId: patient.id, patientUserId: patient.userId, time: toColombo(stored.startsAt).time, startsAt: stored.startsAt as Date };
  }
  type Visit = Awaited<ReturnType<typeof visit>>;

  const mode = (m: string) => api().patch('/settings/automation/functions/LIVE_CARE').set(bearer(adminToken)).send({ mode: m }).expect(200);
  const policy = (body: object) => api().patch('/settings/automation/actions/live_care.replace_caregiver').set(bearer(adminToken)).send(body);
  const cover = async (v: Visit) => (await api().get(`/visits/${v.id}/cover`).set(bearer(staffToken)).expect(200)).body as ShiftCover;
  const offer = (v: Visit, people: Person[], extra: object = {}) => api().post(`/visits/${v.id}/cover/offers`).set(bearer(staffToken)).send({ caregiverIds: people.map((p) => p.id), ...extra });
  const myOffers = async (p: Person) => (await api().get('/me/care-offers').set(bearer(p.token)).expect(200)).body as CaregiverCareOffer[];
  const myOffer = async (p: Person, v: Visit) => (await myOffers(p)).find((o) => o.kind === 'COVER' && o.reference === v.reference)!;
  const accept = (p: Person, offerId: string) => api().post(`/me/care-offers/${offerId}/accept`).set(bearer(p.token));
  const decline = (p: Person, offerId: string) => api().post(`/me/care-offers/${offerId}/decline`).set(bearer(p.token)).send({ reason: 'NOT_AVAILABLE' });
  const shiftRow = async (v: Visit) => (await db.select().from(bookingShifts).where(eq(bookingShifts.id, v.id)))[0];
  const staffShift = async (v: Visit) =>
    ((await api().get(`/bookings/${v.bookingId}`).set(bearer(staffToken)).expect(200)).body.shifts as { id: string; isCover: boolean; checkIn: StaffCheckIn }[]).find((s) => s.id === v.id)!;
  const offerRows = (v: Visit) => db.select().from(requestOffers).where(eq(requestOffers.shiftId, v.id)).orderBy(requestOffers.createdAt);
  const sweep = (at: Date, ...visits: Visit[]) => agent.sweep(at, visits.map((v) => v.id));
  const decisionsFor = async (v: Visit, action: string) =>
    (await db.select().from(agentDecisions).where(and(eq(agentDecisions.caseType, 'BOOKING'), eq(agentDecisions.caseId, v.bookingId))).orderBy(agentDecisions.createdAt)).filter((d) => d.action === action);
  const note = async (v: Visit) => (await api().get(`/automation/cases/BOOKING/${v.bookingId}`).set(bearer(staffToken)).expect(200)).body.handoverNote;
  const told = (label: string) => notify.mock.calls.filter((c) => c[3] === label);
  const text = (call: unknown[]) => (call[1] as (lang: 'en') => { title: string; body: string })('en');
  const emails = (label: string) => sendEmail.mock.calls.filter((c) => c[2] === label);
  /** Stand-ins from earlier cases are taken out of the district, so each case ranks only its own. */
  const clearDistrict = () => db.update(caregivers).set({ districtId: null, cityId: null }).where(and(eq(caregivers.districtId, districtId), or(like(caregivers.fullName, 'Cover Caregiver %'), like(caregivers.fullName, 'Booked Caregiver %'))));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(unlimitedThrottle).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get<Database>(DRIZZLE);
    jwt = app.get(JwtService);
    agent = app.get(LiveCareAgentService);
    accessSecret = app.get(ConfigService).get<string>('JWT_ACCESS_SECRET')!;
    const login = (email: string) => api().post('/auth/login').send({ email, password: SEED_PASSWORD });
    staffToken = (await login('staff@care-platform.local')).body.accessToken;
    adminToken = (await login('admin@care-platform.local')).body.accessToken;
    const tree = (await api().get('/public/meta/locations/tree?locale=en').expect(200)).body as { districts: { id: number }[] }[];
    // A district nobody lives in or travels to (and not the matching cases' own, the last one), so only this file's stand-ins can be suggested.
    const all = tree.flatMap((p) => p.districts).slice(0, -1);
    const [lived, travelled] = await Promise.all([
      db.selectDistinct({ id: caregivers.districtId }).from(caregivers).where(isNotNull(caregivers.districtId)),
      db.selectDistinct({ id: cities.districtId }).from(preferredLocations).innerJoin(cities, eq(cities.id, preferredLocations.cityId)),
    ]);
    const taken = new Set([...lived, ...travelled].map((r) => r.id));
    const empty = [...all].reverse().find((d) => !taken.has(d.id));
    if (!empty) throw new Error('The cover cases need a district with no caregivers in it');
    districtId = empty.id;
    cityId = (await api().get(`/public/meta/locations/cities?districtId=${districtId}&locale=en`).expect(200)).body[0].id;
    intake = {
      registrantType: 'GUARDIAN', recipientName: 'Sunil Fernando', recipientRelationship: 'PARENT', recipientAge: 78, recipientGender: 'MALE',
      preferredContactMethod: 'PHONE_CALL', districtId, cityId, careNeeds: 'Needs help with bathing, meals and medication reminders.',
      careSchedule: 'DAY', careStart: 'WITHIN_WEEK',
    };
    await api().post('/settings/automation/master').set(bearer(adminToken)).send({ on: false }).expect(200);
    await api().patch('/settings/check-in').set(bearer(adminToken)).send({ enabled: true, earlyMinutes: 60, lateAfterMinutes: 15 }).expect(200);
    await mode('MANUAL');
  });

  beforeEach(async () => {
    await clearDistrict();
    notify = jest.spyOn(app.get(NotificationsService), 'notify');
    canSend = jest.spyOn(app.get(WhatsappProviderService), 'canSendUpdates').mockReturnValue(true);
    sendUpdate = jest.spyOn(app.get(WhatsappProviderService), 'sendUpdate').mockResolvedValue({ provider: 'CONSOLE' });
    sendEmail = jest.spyOn(app.get(EmailService), 'sendNotificationEmail').mockResolvedValue();
  });
  afterEach(() => {
    notify.mockRestore();
    canSend.mockRestore();
    sendUpdate.mockRestore();
    sendEmail.mockRestore();
  });

  afterAll(async () => {
    await clearDistrict();
    await policy({ autoAllowed: false });
    await mode('MANUAL');
    await api().patch('/settings/check-in').set(bearer(adminToken)).send({ enabled: false, earlyMinutes: 60, lateAfterMinutes: 15 }).expect(200);
    await app.close();
  });

  describe('by hand', () => {
    it('suggests who could cover, offers the shift, and puts the first to accept on it', async () => {
      const v = await visit(30);
      const [a, b] = [await standIn(), await standIn()];
      // Someone who lives there too, but is working at that time.
      const other = await visit(60);
      await db.update(caregivers).set({ districtId, cityId }).where(eq(caregivers.id, other.booked.id));

      const before = await cover(v);
      expect(before).toMatchObject({ bookingReference: v.reference, blocked: null, isCover: false, pay: { rateType: 'DAILY', amount: 2800 }, offerMinutes: 15, offers: [] });
      expect(before.caregiver.registrationNumber).toBe(v.booked.reg);
      expect(before.suggestions.map((s) => s.caregiverId).sort()).toEqual([a.id, b.id].sort());
      expect(before.suggestions[0]).toMatchObject({ fullName: expect.stringContaining('Cover Caregiver'), reasons: expect.arrayContaining(['Checked by the office', 'Lives in the same town']) });

      const sent = (await offer(v, [a, b]).expect(201)).body as ShiftCover;
      expect(sent.offers).toHaveLength(2);
      expect(sent.offers.every((o) => o.kind === 'COVER' && o.status === 'OFFERED' && o.shiftId === v.id && o.requestId === null && o.payRate === 2800 && o.clientRate === null)).toBe(true);
      const until = new Date(sent.offers[0].expiresAt).getTime() - Date.now();
      expect(until).toBeGreaterThan(13 * 60_000);
      expect(until).toBeLessThanOrEqual(15 * 60_000);
      // Asked already: no longer suggested.
      expect(sent.suggestions).toHaveLength(0);

      // What the caregiver is told and shown: when, where, the pay - nothing about the client.
      const mine = await myOffer(a, v);
      expect(mine).toMatchObject({ kind: 'COVER', status: 'OFFERED', reference: v.reference, rateType: 'DAILY', payRate: 2800, desiredStartDate: null });
      expect(new Date(mine.shift!.startsAt).getTime()).toBe(v.startsAt.getTime());
      expect(mine.district).not.toBeNull();
      expect(text(told(`offer ${mine.id}`)[0])).toEqual({ title: 'A shift needs cover', body: expect.stringContaining('answer before it runs out') });
      const outside = sendUpdate.mock.calls.map((c) => String(c[3])).filter((m) => m.includes('A shift needs cover'));
      expect(outside).toHaveLength(2);
      for (const secret of ['Nimal', 'Perera', 'Sunil', 'Fernando', 'bathing', v.booked.reg, v.reference]) expect(outside.join(' ')).not.toContain(secret);
      for (const secret of ['Nimal', 'Perera', 'Sunil', 'Fernando', 'bathing', 'Booked Caregiver']) expect(JSON.stringify(await myOffers(a))).not.toContain(secret);
      expect((await api().get('/me/care-offers/count').set(bearer(a.token)).expect(200)).body).toEqual({ waiting: 1 });

      // One says no; the other takes it.
      await decline(b, (await myOffer(b, v)).id).expect(200);
      const after = (await accept(a, mine.id).expect(200)).body as CaregiverCareOffer[];
      expect(after.find((o) => o.id === mine.id)).toMatchObject({ status: 'ACCEPTED' });
      expect((await shiftRow(v)).caregiverId).toBe(a.id);
      expect(await staffShift(v)).toMatchObject({ isCover: true });
      const events = (await api().get(`/bookings/${v.bookingId}`).set(bearer(staffToken)).expect(200)).body.events as { note: string | null }[];
      expect(events.some((e) => e.note?.includes('cover caregiver assigned'))).toBe(true);
      // Pressing Accept again changes nothing.
      await accept(a, mine.id).expect(200);

      // The caregiver who was replaced, the client and the staff member who sent the offer are told.
      expect(text(told(`shift covered ${v.id}`)[0])).toEqual({ title: 'Your shift has been given to another caregiver', body: expect.stringContaining(v.time) });
      expect(told(`shift covered ${v.id}`)[0][0]).toEqual([v.booked.userId]);
      const toClient = told(`cover coming ${v.id}`)[0];
      expect(toClient[0]).toEqual([v.patientUserId]);
      expect(text(toClient)).toEqual({ title: 'A different caregiver is coming', body: expect.stringContaining(a.name) });
      const mail = emails(`cover accepted ${mine.id}`);
      expect(mail).toHaveLength(1);
      expect(mail[0][0]).toEqual(['staff@care-platform.local']);
      expect((mail[0][1] as { subject: string }).subject).toBe(`Cover found: ${v.reference}`);
      expect(JSON.stringify(mail[0][1])).toContain(a.reg);

      // The shift is now theirs: it is on their roster and the client's code lets them in. It is no longer the first caregiver's.
      const roster = (await api().get('/me/shifts').set(bearer(a.token)).expect(200)).body as CaregiverShift[];
      expect(roster.some((s) => s.id === v.id)).toBe(true);
      const code = (await staffShift(v)).checkIn.arrivalCode!;
      expect((await api().post(`/me/shifts/${v.id}/check-in`).set(bearer(v.booked.token)).send({ code })).status).toBeGreaterThanOrEqual(400);
      await api().post(`/me/shifts/${v.id}/check-in`).set(bearer(a.token)).send({ code }).expect((r) => expect(r.status).toBeLessThan(300));
      expect((await staffShift(v)).checkIn).toMatchObject({ state: 'IN', inBy: 'CAREGIVER' });
      expect(await cover(v)).toMatchObject({ blocked: 'CHECKED_IN', isCover: true, suggestions: [] });
    });

    it('refuses a caregiver who is busy then, already asked or already on the shift, and a shift that cannot be covered', async () => {
      const v = await visit(45);
      const [a, b] = [await standIn(), await standIn()];
      const other = await visit(60);
      const says = async (res: request.Test, status: number) => (await res.expect(status)).body.message as string;

      expect(await says(offer(v, [other.booked]), 409)).toBe('This caregiver has another shift at that time');
      expect(await says(offer(v, [v.booked]), 400)).toBe('This caregiver is already on the shift');
      expect(await says(offer(v, []), 400)).toContain('Choose at least one caregiver');
      // One who cannot take it stops the whole send: nobody has been messaged.
      expect(await says(offer(v, [a, other.booked]), 409)).toBe('This caregiver has another shift at that time');
      expect(await offerRows(v)).toHaveLength(0);

      await offer(v, [a]).expect(201);
      expect(await says(offer(v, [a]), 409)).toBe('This caregiver already has a cover offer waiting for this shift');
      // Staff take it back; the caregiver is told and can no longer accept.
      const mine = await myOffer(a, v);
      const back = (await api().post(`/visits/${v.id}/cover/offers/${mine.id}/withdraw`).set(bearer(staffToken)).expect(200)).body as ShiftCover;
      expect(back.offers[0]).toMatchObject({ status: 'WITHDRAWN' });
      expect(await says(accept(a, mine.id), 409)).toBe('This job is no longer open');
      expect(await says(api().post(`/visits/${v.id}/cover/offers/${mine.id}/withdraw`).set(bearer(staffToken)), 400)).toBe('Only an offer that is still waiting can be withdrawn');
      // A caregiver who takes a shift at that time elsewhere can no longer accept this one.
      await offer(v, [b]).expect(201);
      const theirs = await myOffer(b, v);
      await db.update(bookingShifts).set({ caregiverId: b.id }).where(eq(bookingShifts.id, other.id));
      expect(await says(accept(b, theirs.id), 409)).toBe('You have another shift at that time');
      await db.update(bookingShifts).set({ caregiverId: other.booked.id }).where(eq(bookingShifts.id, other.id));

      // Someone else's offer answers as one that does not exist, and only staff reach the cover page.
      await accept(a, theirs.id).expect(404);
      await api().get(`/visits/${v.id}/cover`).set(bearer(a.token)).expect(403);

      // Cancelled: nothing to cover.
      await api().patch(`/bookings/${v.bookingId}/shifts/${v.id}`).set(bearer(staffToken)).send({ status: 'CANCELLED', note: 'The family is away' }).expect(200);
      expect(await cover(v)).toMatchObject({ blocked: 'NOT_SCHEDULED', suggestions: [] });
      expect(await says(offer(v, [a]), 400)).toBe('Only a scheduled shift can be offered as cover');
      expect(await says(accept(b, theirs.id), 409)).toBe('This job is no longer open');

      // Over: nothing to cover either.
      const past = await visit(-300);
      expect(await cover(past)).toMatchObject({ blocked: 'ENDED' });
      expect(await says(offer(past, [a]), 400)).toBe('This shift is already over');
    });

    it('covers a shift the client was billed for in advance: the caregiver changes as a correction and the invoice stays as it was', async () => {
      const v = await visit(40);
      const a = await standIn();
      const day = toColombo(v.startsAt).date;
      const draft = (await api().post('/invoices').set(bearer(staffToken)).send({ bookingId: v.bookingId, basis: 'SCHEDULED', periodStart: addDays(day, -1), periodEnd: addDays(day, 1) }).expect(201)).body;
      const issued = (await api().post(`/invoices/${draft.id}/issue`).set(bearer(staffToken)).send({ notify: false }).expect(200)).body as { id: string; number: string; total: string };
      // Staff changing the caregiver on the roster is still refused for a billed shift...
      await api().patch(`/bookings/${v.bookingId}/shifts/${v.id}`).set(bearer(staffToken)).send({ caregiverId: a.id }).expect(409);

      // ...but cover works: staff are told where the shift is billed, and can offer it.
      expect(await cover(v)).toMatchObject({ blocked: null, billedOn: `invoice ${issued.number}` });
      await offer(v, [a]).expect(201);
      const mine = await myOffer(a, v);
      await accept(a, mine.id).expect(200);
      expect((await shiftRow(v)).caregiverId).toBe(a.id);
      expect((await offerRows(v))[0]).toMatchObject({ status: 'ACCEPTED' });

      // The booking's history holds the correction and its reason; the invoice is untouched and nothing new is owed.
      const booking = (await api().get(`/bookings/${v.bookingId}`).set(bearer(staffToken)).expect(200)).body as { events: { type: string; note: string | null }[] };
      const amended = booking.events.find((e) => e.type === 'AMENDED');
      expect(amended?.note).toContain(`Cover for a caregiver who could not come: ${a.reg} in place of ${v.booked.reg}`);
      const after = (await api().get(`/invoices/${issued.id}`).set(bearer(staffToken)).expect(200)).body as { status: string; total: string; number: string; lines: { shiftId: string | null }[] };
      expect(after).toMatchObject({ status: 'ISSUED', total: issued.total, number: issued.number });
      expect(after.lines.some((l) => l.shiftId === v.id)).toBe(true);
      expect((await db.select().from(invoices).where(eq(invoices.bookingId, v.bookingId))).length).toBe(1);
      // The same people are told as for any cover, and the client hears nothing about money.
      expect(told(`shift covered ${v.id}`)).toHaveLength(1);
      expect(told(`cover coming ${v.id}`)).toHaveLength(1);
      expect(told(`correction ${v.reference}`)).toHaveLength(0);
    });

    it('gives the shift to exactly one of two caregivers who accept at the same moment', async () => {
      const v = await visit(30);
      const [a, b] = [await standIn(), await standIn()];
      await offer(v, [a, b]).expect(201);
      const [oa, ob] = [await myOffer(a, v), await myOffer(b, v)];
      const results = await Promise.all([accept(a, oa.id), accept(b, ob.id)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      const winner = results[0].status === 200 ? a : b;
      expect((await shiftRow(v)).caregiverId).toBe(winner.id);
      const rows = await offerRows(v);
      expect(rows.map((r) => r.status).sort()).toEqual(['ACCEPTED', 'WITHDRAWN']);
      expect(rows.find((r) => r.status === 'ACCEPTED')!.caregiverId).toBe(winner.id);
    });

    it('closes the offers when the caregiver checks in after all', async () => {
      const v = await visit(-10);
      const [a, b] = [await standIn(), await standIn()];
      await offer(v, [a, b]).expect(201);
      const today = (await api().get('/visits/today').set(bearer(staffToken)).expect(200)).body.visits as { shiftId: string; coverWaiting: number }[];
      const listed = today.find((t) => t.shiftId === v.id);
      if (listed) expect(listed.coverWaiting).toBe(2);

      await api().post(`/visits/${v.id}/check-in`).set(bearer(staffToken)).send({}).expect((r) => expect(r.status).toBeLessThan(300));
      // Even before the clean-up runs, nobody can take a shift whose caregiver is there.
      const res = await accept(a, (await myOffer(a, v)).id).expect(409);
      expect(res.body.message).toBe('This job is no longer open');
      await app.get(JobsService).runDue(new Date(), [COVER_CLOSE_JOB]);
      expect((await offerRows(v)).map((r) => r.status)).toEqual(['WITHDRAWN', 'WITHDRAWN']);
      expect(told('offer no longer open').some((c) => (c[0] as string[]).includes(b.userId))).toBe(true);
      expect((await shiftRow(v)).caregiverId).toBe(v.booked.id);
      expect(await myOffer(b, v)).toMatchObject({ status: 'WITHDRAWN' });
    });
  });

  describe('the live-care agent', () => {
    const REPLACE = 'live_care.replace_caregiver';
    const FLAG = 'live_care.flag_visit';

    it('does nothing in Manual, and waits until the caregiver has had time to answer the chase', async () => {
      const v = await visit(-31);
      await standIn();
      await mode('MANUAL');
      await sweep(new Date(), v);
      expect(await decisionsFor(v, REPLACE)).toHaveLength(0);

      await mode('AUTO');
      await policy({ autoAllowed: false });
      const early = await visit(-20);
      await sweep(new Date(), early);
      expect(await decisionsFor(early, REPLACE)).toHaveLength(0);
      expect(await offerRows(early)).toHaveLength(0);
    });

    it('proposes who to ask until it has earned acting alone; approving sends the offers', async () => {
      await mode('AUTO');
      await policy({ autoAllowed: false });
      const v = await visit(-31);
      const people = [await standIn(), await standIn()];
      await sweep(new Date(), v);
      const [proposed] = await decisionsFor(v, REPLACE);
      expect(proposed).toMatchObject({ outcome: 'PROPOSED', mode: 'AUTO', tier: 2 });
      expect(proposed.reason).toContain(`Offer the ${v.time} visit as cover to`);
      expect(proposed.reason).toMatch(new RegExp(`${v.booked.reg} is 3[01] min late, was asked to check in, and has not$`));
      const p = proposed.proposal as CoverProposal;
      expect(p.candidates.map((c) => c.caregiverId).sort()).toEqual(people.map((x) => x.id).sort());
      // The log names caregivers by registration number only, and says nothing about the client.
      for (const secret of ['Cover Caregiver', 'Booked Caregiver', 'Nimal', 'Perera', 'Sunil', ...people.map((x) => x.phone)]) expect(JSON.stringify(proposed)).not.toContain(secret);
      expect(await offerRows(v)).toHaveLength(0);
      // Looking again proposes nothing new.
      await sweep(new Date(), v);
      expect(await decisionsFor(v, REPLACE)).toHaveLength(1);

      await api().post(`/automation/decisions/${proposed.id}/approve`).set(bearer(staffToken)).expect(200);
      const rows = await offerRows(v);
      expect(rows.map((r) => r.caregiverId).sort()).toEqual(people.map((x) => x.id).sort());
      expect(rows.every((r) => r.kind === 'COVER' && r.status === 'OFFERED' && r.payRate === 2800)).toBe(true);
      expect(await note(v)).toMatchObject({ done: `Offered the ${v.time} visit as cover to 2 caregivers (${v.booked.reg} has not checked in)`, waiting: expect.stringContaining('One of them to accept by') });

      // One accepts: the agent sent the offer, so the office's alert list hears that cover was found.
      const mine = await myOffer(people[0], v);
      await accept(people[0], mine.id).expect(200);
      expect((await shiftRow(v)).caregiverId).toBe(people[0].id);
      expect((await offerRows(v)).map((r) => r.status).sort()).toEqual(['ACCEPTED', 'WITHDRAWN']);
      const mail = emails(`cover accepted ${mine.id}`);
      expect(mail).toHaveLength(1);
      expect((mail[0][0] as string[]).length).toBeGreaterThan(0);
      expect(await note(v)).toMatchObject({ done: expect.stringContaining(`${people[0].reg} accepted the ${v.time} visit as cover for ${v.booked.reg}`) });
      // With someone on their way, the agent asks nobody else.
      await sweep(minutes(20), v);
      expect(await decisionsFor(v, REPLACE)).toHaveLength(1);
    });

    it('once earned: asks three, then the next, then tells staff nobody took it', async () => {
      await mode('AUTO');
      await api().patch('/settings/automation').set(bearer(adminToken)).send({ cases: 10 }).expect(200);
      for (let i = 0; i < 10; i++) {
        const d = await app.get(AutomationService).decide({ action: 'live_care.replace_caregiver', reason: 'Offer the visit as cover' });
        await api().post(`/automation/decisions/${d.decisionId}/review`).set(bearer(staffToken)).send({ verdict: 'AGREED' }).expect(200);
      }
      await policy({ autoAllowed: true }).expect(200);

      const v = await visit(-31);
      const people = [await standIn(), await standIn(), await standIn(), await standIn()];
      await sweep(new Date(), v);
      const [first] = await decisionsFor(v, REPLACE);
      expect(first).toMatchObject({ outcome: 'EXECUTED', executionError: null });
      let rows = await offerRows(v);
      expect(rows).toHaveLength(3);
      const until = rows[0].expiresAt.getTime() - Date.now();
      expect(until).toBeGreaterThan(13 * 60_000);
      expect(until).toBeLessThanOrEqual(15 * 60_000);
      // While they decide, nothing more is sent.
      await sweep(minutes(5), v);
      expect(await offerRows(v)).toHaveLength(3);

      // Nobody answered in time: the one caregiver not yet asked is.
      await sweep(minutes(16), v);
      rows = await offerRows(v);
      expect(rows).toHaveLength(4);
      expect(new Set(rows.map((r) => r.caregiverId))).toEqual(new Set(people.map((x) => x.id)));
      expect((await decisionsFor(v, REPLACE))[1].reason).toContain('round 2');
      expect(await decisionsFor(v, FLAG)).toHaveLength((await decisionsFor(v, FLAG)).filter((d) => (d.proposal as { kind: string }).kind !== 'NO_COVER').length);

      // Nobody again, and nobody left to ask: staff are told, once.
      await sweep(minutes(32), v);
      const gaveUp = (await decisionsFor(v, FLAG)).filter((d) => (d.proposal as { kind: string }).kind === 'NO_COVER');
      expect(gaveUp).toHaveLength(1);
      expect(gaveUp[0]).toMatchObject({ outcome: 'EXECUTED', reason: `Nobody took the ${v.time} visit as cover for ${v.booked.reg}: 4 caregivers were asked` });
      const mail = emails(`visit ${v.id} NO_COVER`);
      expect(mail).toHaveLength(1);
      expect((mail[0][1] as { subject: string }).subject).toBe(`No cover found: ${v.reference}`);
      expect(await note(v)).toMatchObject({ waiting: 'Staff to find cover by phone, or tell the client the visit will not happen' });
      await sweep(minutes(40), v);
      expect(emails(`visit ${v.id} NO_COVER`)).toHaveLength(1);
      expect(await offerRows(v)).toHaveLength(4);
      expect((await shiftRow(v)).caregiverId).toBe(v.booked.id);
    });

    it('leaves a note, not a second email, when there is nobody to ask at all', async () => {
      await mode('AUTO');
      const v = await visit(-31);
      await sweep(new Date(), v);
      const flags = (await decisionsFor(v, FLAG)).filter((d) => (d.proposal as { kind: string }).kind === 'NO_COVER');
      expect(flags).toHaveLength(1);
      expect(flags[0].reason).toBe(`There is nobody to offer the ${v.time} visit to as cover for ${v.booked.reg}`);
      expect(emails(`visit ${v.id} NO_COVER`)).toHaveLength(0);
      expect(await decisionsFor(v, REPLACE)).toHaveLength(0);
    });

    it('in Shadow only logs who it would ask, and is scored by who staff put on the shift', async () => {
      await mode('SHADOW');
      const [v, w] = [await visit(-31), await visit(-31)];
      const people = [await standIn(), await standIn()];
      const outsider = await caregiver('Phoned Caregiver', false);
      await sweep(new Date(), v, w);
      const [mineV] = await decisionsFor(v, REPLACE);
      const [mineW] = await decisionsFor(w, REPLACE);
      expect(mineV).toMatchObject({ outcome: 'SHADOW', staffVerdict: null });
      expect(await offerRows(v)).toHaveLength(0);
      expect(told(`offer ${v.id}`)).toHaveLength(0);

      // Staff put one of the caregivers it named on the first shift, and someone else on the second.
      await api().patch(`/bookings/${v.bookingId}/shifts/${v.id}`).set(bearer(staffToken)).send({ caregiverId: people[0].id }).expect(200);
      await api().patch(`/bookings/${w.bookingId}/shifts/${w.id}`).set(bearer(staffToken)).send({ caregiverId: outsider.id }).expect(200);
      await sweep(new Date(), v, w);
      const [[scoredV], [scoredW]] = [await db.select().from(agentDecisions).where(eq(agentDecisions.id, mineV.id)), await db.select().from(agentDecisions).where(eq(agentDecisions.id, mineW.id))];
      expect(scoredV).toMatchObject({ staffVerdict: 'AGREED', staffNote: 'Scored automatically: staff put one of these caregivers on the shift' });
      expect(scoredW).toMatchObject({ staffVerdict: 'DIFFERED', staffNote: 'Scored automatically: staff put a different caregiver on the shift' });
      const [b] = await db.select().from(bookings).where(eq(bookings.id, v.bookingId));
      expect(b.caregiverId).toBe(v.booked.id);
    });
  });
});
