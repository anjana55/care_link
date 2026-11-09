import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID as uuid } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { addDays, colomboToday, toColombo } from '@care-platform/shared';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { bookingShifts, bookings, caregiverDocuments, caregivers, invoices, notifications, patients, reminderSends } from '../src/database/schema';
import { BookingNotifier } from '../src/bookings/booking-notifier.service';
import { NotificationsService } from '../src/notifications/notifications.service';
import { ReminderSweepService } from '../src/notifications/reminder-sweep.service';
import { AccountDeletionService } from '../src/account-deletion/account-deletion.service';
import { SEED_PASSWORD } from './seed-password';

/**
 * The bell over real HTTP: notices kept from the notifiers, read and unread,
 * in each language; the live To do list; staff announcements; reminders sent
 * once and within the daily cap; and who may see what.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

const HOUR = 3_600_000;

describe('In-app notifications (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let jwt: JwtService;
  let accessSecret: string;
  let staffToken: string;
  let adminToken: string;
  let intake: Record<string, unknown>;
  let districtId: number;

  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const run = Math.floor(Date.now() / 1000) % 10_000;
  let n = 0;
  const letters = (i: number) => String.fromCharCode(65 + (i % 26)) + String.fromCharCode(97 + (Math.floor(i / 26) % 26)) + 'son';
  const newPhone = () => `075${String(run * 1000 + ++n).padStart(7, '0')}`;

  async function newCaregiver() {
    const phone = newPhone();
    const reg = await api()
      .post('/auth/register-caregiver/unified')
      .send({
        phone, consentAccepted: true, fullName: `Bell Caregiver ${phone}`, permanentAddress: '1 Lake Road, Kandy',
        dateOfBirth: '1988-01-20', gender: 'FEMALE', civilStatus: 'MARRIED', emergencyContactName: 'EC', emergencyContactNumber: '0770001111',
        emergencyContactRelationship: 'Husband',
      })
      .expect(201);
    const [row] = await db.select().from(caregivers).where(eq(caregivers.registrationNumber, reg.body.registrationNumber));
    await db.execute(sql`UPDATE caregivers SET status = 'ACTIVE', district_id = ${districtId} WHERE id = ${row.id}`);
    const token = jwt.sign({ sub: row.userId, role: 'CAREGIVER', caregiverId: row.id }, { secret: accessSecret, expiresIn: '10m' });
    return { id: row.id, userId: row.userId!, publicId: row.publicId, token };
  }

  async function newClient() {
    const reg = await api()
      .post('/auth/register-patient')
      .send({ email: `bell-client-${run}-${++n}@example.com`, password: 'SelfRegPass123', fullName: `Bell Client ${letters(++n)}`, phone: newPhone(), consentAccepted: true, ...intake })
      .expect(201);
    const [row] = await db.select().from(patients).where(eq(patients.id, reg.body.patientId));
    const token = jwt.sign({ sub: row.userId, role: 'PATIENT_GUARDIAN', patientId: row.id }, { secret: accessSecret, expiresIn: '10m' });
    return { patientId: row.id, userId: row.userId!, token };
  }

  async function booking(patientId: string, caregiverId: string, shifts: { from: number; hours?: number }[]) {
    const id = uuid();
    await db.insert(bookings).values({
      id, reference: `NT${run}${String(++n).padStart(4, '0')}`.slice(0, 16), patientId, caregiverId, status: 'CONFIRMED',
      scheduleType: 'DAY', daysOfWeek: '1,2,3,4,5', shiftStartTime: '08:00', shiftEndTime: '17:00', startDate: '2026-01-01', endDate: '2026-12-31',
    });
    for (const s of shifts) {
      const startsAt = new Date(Date.now() + s.from * HOUR);
      await db.insert(bookingShifts).values({ id: uuid(), bookingId: id, caregiverId, startsAt, endsAt: new Date(startsAt.getTime() + (s.hours ?? 2) * HOUR), status: 'SCHEDULED' });
    }
    return id;
  }

  async function invoice(patientId: string, dueDate: string, total = '12500.00', paid = '0.00') {
    const id = uuid();
    await db.insert(invoices).values({ id, number: `NT-${run}-${++n}`, patientId, status: 'ISSUED', basis: 'MANUAL', dueDate, billToName: 'Bell Client', total, amountPaid: paid });
    return id;
  }

  const summary = (token: string) => api().get('/me/notifications/summary').set(bearer(token));
  const list = (token: string, lang = 'en') => api().get(`/me/notifications?lang=${lang}`).set(bearer(token));

  /** notify() is fire and forget: wait for the row to land. */
  async function waitFor<T>(f: () => Promise<T | undefined | null | false>, ms = 5000): Promise<T> {
    const until = Date.now() + ms;
    for (;;) {
      const v = await f();
      if (v) return v as T;
      if (Date.now() > until) throw new Error('timed out waiting');
      await new Promise((r) => setTimeout(r, 100));
    }
  }

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
    const tree = (await api().get('/public/meta/locations/tree?locale=en').expect(200)).body as { districts: { id: number }[] }[];
    districtId = tree.flatMap((p) => p.districts)[0].id;
    const cityId = (await api().get(`/public/meta/locations/cities?districtId=${districtId}&locale=en`).expect(200)).body[0].id;
    intake = {
      registrantType: 'GUARDIAN', recipientName: 'Sunil Fernando', recipientRelationship: 'PARENT', recipientAge: 78, recipientGender: 'MALE',
      preferredContactMethod: 'PHONE_CALL', districtId, cityId, careNeeds: 'Needs help with bathing, meals and medication reminders.',
      careSchedule: 'DAY', careStart: 'WITHIN_WEEK',
    };
    await api().patch('/settings/notifications').set(bearer(adminToken)).send({ remindersEnabled: true, quietStartHour: 21, quietEndHour: 7, dailyReminderCap: 2 }).expect(200);
  });

  afterAll(async () => {
    await api().patch('/settings/notifications').set(bearer(adminToken)).send({ remindersEnabled: true, quietStartHour: 21, quietEndHour: 7, dailyReminderCap: 2, retentionDays: 180 });
    await app.close();
  });

  it('keeps every notice a notifier sends, in all three languages, unread until opened - and only for its owner', async () => {
    const cg = await newCaregiver();
    const client = await newClient();
    const other = await newClient();
    const id = await booking(client.patientId, cg.id, [{ from: 48 }]);

    await app.get(BookingNotifier).bookingConfirmed(id);
    const items = await waitFor(async () => {
      const res = await list(client.token).expect(200);
      return res.body.items.length ? res.body.items : null;
    });
    expect(items[0]).toMatchObject({ category: 'BOOKING', path: `/bookings/${id}`, readAt: null, important: false });
    expect(items[0].body).toContain('NT');
    expect(items[0].title).not.toContain('{brand}');
    // The caregiver hears too, about their shifts.
    const cgItems = await waitFor(async () => (await list(cg.token).expect(200)).body.items[0]);
    expect(cgItems.path).toBe('/shifts');

    const si = (await list(client.token, 'si').expect(200)).body.items[0];
    expect(si.id).toBe(items[0].id);
    expect(si.title).not.toBe(items[0].title);

    expect((await summary(client.token).expect(200)).body.unread).toBe(1);
    // Someone else can't mark it read.
    expect((await api().post('/me/notifications/read').set(bearer(other.token)).send({ ids: [items[0].id] }).expect(200)).body.marked).toBe(0);
    expect((await api().post('/me/notifications/read').set(bearer(client.token)).send({ paths: [`/bookings/${id}`] }).expect(200)).body.marked).toBe(1);
    const after = await summary(client.token).expect(200);
    expect(after.body.unread).toBe(0);
    expect(after.body.badge).toBe(after.body.todos.length);
    expect((await list(client.token).expect(200)).body.items[0].readAt).not.toBeNull();
  });

  it('pages through the history', async () => {
    const client = await newClient();
    const notices = app.get(NotificationsService);
    for (let i = 0; i < 23; i++) await notices.deliver([client.userId], () => ({ title: `Notice ${i}`, body: 'b' }), '/notifications', 'page test', { push: false });
    const first = await list(client.token).expect(200);
    expect(first.body.items).toHaveLength(20);
    expect(first.body.items[0].title).toBe('Notice 22');
    const second = await api().get(`/me/notifications?before=${encodeURIComponent(first.body.nextCursor)}`).set(bearer(client.token)).expect(200);
    expect(second.body.items.map((x: { title: string }) => x.title)).toEqual(['Notice 2', 'Notice 1', 'Notice 0']);
    expect(second.body.nextCursor).toBeNull();
    await api().post('/me/notifications/read').set(bearer(client.token)).send({ all: true }).expect(200);
    expect((await summary(client.token).expect(200)).body.unread).toBe(0);
  });

  it("works out a client's To do live: an invoice to pay goes as soon as it is paid, and a caregiver to rate", async () => {
    const cg = await newCaregiver();
    const client = await newClient();
    const today = colomboToday();
    const overdue = await invoice(client.patientId, addDays(today, -3));
    const partPaid = await invoice(client.patientId, addDays(today, 5), '8000.00', '3000.00');
    await invoice(client.patientId, addDays(today, 5), '5000.00', '5000.00'); // paid in full
    const worked = await booking(client.patientId, cg.id, [{ from: -30 }]);

    const s = (await summary(client.token).expect(200)).body;
    const keys = s.todos.map((t: { key: string }) => t.key);
    expect(keys).toEqual(expect.arrayContaining([`invoice:${overdue}`, `invoice:${partPaid}`, `review:${worked}:${cg.publicId}`]));
    expect(keys).toHaveLength(3);
    expect(s.todos[0]).toMatchObject({ key: `invoice:${overdue}`, kind: 'PAY_INVOICE', urgent: true, path: `/invoices/${overdue}` });
    expect(s.todos.find((t: { key: string }) => t.key === `invoice:${partPaid}`).params.amount).toContain('5,000');
    expect(s.badge).toBe(s.unread + 3);

    await db.update(invoices).set({ status: 'PAID', amountPaid: '12500.00' }).where(eq(invoices.id, overdue));
    const next = (await summary(client.token).expect(200)).body.todos.map((t: { key: string }) => t.key);
    expect(next).not.toContain(`invoice:${overdue}`);
  });

  it("works out a caregiver's To do: missing and rejected documents, expiry, and today's shift", async () => {
    const cg = await newCaregiver();
    const client = await newClient();
    const first = (await summary(cg.token).expect(200)).body.todos;
    expect(first.filter((t: { kind: string }) => t.kind === 'UPLOAD_DOCUMENT').map((t: { params: { document: string } }) => t.params.document).sort()).toEqual(['gn', 'identity', 'police']);

    const rejected = uuid();
    await db.insert(caregiverDocuments).values([
      { id: uuid(), caregiverId: cg.id, documentType: 'NIC', storageKey: `k-${uuid()}`, originalFilename: 'nic.jpg', mimeType: 'image/jpeg', sizeBytes: 10, checksum: 'x', verificationStatus: 'VERIFIED' },
      { id: rejected, caregiverId: cg.id, documentType: 'POLICE_CLEARANCE', storageKey: `k-${uuid()}`, originalFilename: 'p.jpg', mimeType: 'image/jpeg', sizeBytes: 10, checksum: 'x', verificationStatus: 'PENDING' },
      { id: uuid(), caregiverId: cg.id, documentType: 'GRAMA_NILADHARI_CERTIFICATE', storageKey: `k-${uuid()}`, originalFilename: 'g.jpg', mimeType: 'image/jpeg', sizeBytes: 10, checksum: 'x', verificationStatus: 'PENDING', expiresOn: addDays(colomboToday(), 10) },
    ]);
    // Staff reject the police clearance: the caregiver hears, and it is on their To do.
    await api().patch(`/caregivers/${cg.id}/documents/${rejected}/verification`).set(bearer(adminToken)).send({ status: 'REJECTED' }).expect(200);
    const notice = await waitFor(async () => (await list(cg.token).expect(200)).body.items.find((x: { category: string }) => x.category === 'DOCUMENT'));
    expect(notice).toMatchObject({ path: '/documents', important: true });
    expect(notice.body).toContain('police clearance certificate');

    // A shift later today (when today still has room for one).
    const later = new Date(Date.now() + 2 * HOUR);
    if (toColombo(later).date === colomboToday()) await booking(client.patientId, cg.id, [{ from: 2 }]);

    const todos = (await summary(cg.token).expect(200)).body.todos as { kind: string; params: Record<string, unknown>; urgent: boolean }[];
    const kinds = todos.map((t) => `${t.kind}:${t.params.document ?? ''}`);
    expect(kinds).toEqual(expect.arrayContaining(['DOCUMENT_REJECTED:police', 'DOCUMENT_EXPIRING:GRAMA_NILADHARI_CERTIFICATE']));
    expect(kinds.filter((k) => k.startsWith('UPLOAD_DOCUMENT'))).toEqual([]);
    if (toColombo(later).date === colomboToday()) expect(todos.find((t) => t.kind === 'SHIFT_TODAY')?.params.time).toBe(toColombo(later).time);
  });

  it('keeps the bell to clients and caregivers, announcements to staff, settings to admins', async () => {
    const cg = await newCaregiver();
    await api().get('/me/notifications/summary').set(bearer(staffToken)).expect(403);
    await api().get('/announcements').set(bearer(cg.token)).expect(403);
    await api().patch('/settings/notifications').set(bearer(staffToken)).send({ dailyReminderCap: 3 }).expect(403);
    await api().patch('/settings/notifications').set(bearer(adminToken)).send({ dailyReminderCap: 9 }).expect(400);
    await api().get('/me/notifications/summary').expect(401);
  });

  it('publishes an announcement to its audience only, counts who opened it, and takes it back', async () => {
    const client = await newClient();
    const cg = await newCaregiver();
    const created = await api()
      .post('/announcements')
      .set(bearer(staffToken))
      .send({ audience: 'CLIENTS', en: { title: 'Office closed on Poya day', body: 'We are closed on Friday. Urgent? Call the hotline.' }, si: { title: 'පෝය දිනයේ කාර්යාලය වසා ඇත', body: '' }, link: '/account/bookings', important: true, sendPush: false })
      .expect(201);
    expect(created.body).toMatchObject({ publishedAt: null, recipients: 0 });
    expect(created.body.text.si.body).toBe('We are closed on Friday. Urgent? Call the hotline.');
    await api().post('/announcements').set(bearer(staffToken)).send({ audience: 'CLIENTS', en: { title: 'x', body: 'y' }, link: 'javascript:alert(1)' }).expect(400);

    const published = await api().post(`/announcements/${created.body.id}/publish`).set(bearer(staffToken)).expect(200);
    expect(published.body.recipients).toBeGreaterThan(0);
    await api().post(`/announcements/${created.body.id}/publish`).set(bearer(staffToken)).expect(409);
    await api().patch(`/announcements/${created.body.id}`).set(bearer(staffToken)).send({ audience: 'ALL', en: { title: 'a', body: 'b' } }).expect(409);

    const mine = (await list(client.token, 'si').expect(200)).body.items[0];
    expect(mine).toMatchObject({ category: 'ANNOUNCEMENT', important: true, link: '/account/bookings', title: 'පෝය දිනයේ කාර්යාලය වසා ඇත', path: '/notifications' });
    expect((await list(cg.token).expect(200)).body.items.find((x: { category: string }) => x.category === 'ANNOUNCEMENT')).toBeUndefined();

    await api().post('/me/notifications/read').set(bearer(client.token)).send({ ids: [mine.id] }).expect(200);
    expect((await api().get(`/announcements/${created.body.id}`).set(bearer(staffToken)).expect(200)).body.readCount).toBe(1);

    await api().delete(`/announcements/${created.body.id}`).set(bearer(staffToken)).expect(204);
    expect((await list(client.token).expect(200)).body.items.find((x: { id: string }) => x.id === mine.id)).toBeUndefined();
  });

  it("won't push an announcement in quiet hours, but will put it in the bell", async () => {
    const hour = Number(toColombo(new Date()).time.slice(0, 2));
    await api().patch('/settings/notifications').set(bearer(adminToken)).send({ quietStartHour: hour, quietEndHour: (hour + 1) % 24 }).expect(200);
    try {
      const a = await api().post('/announcements').set(bearer(staffToken)).send({ audience: 'CAREGIVERS', en: { title: 'Quiet', body: 'Night' }, sendPush: true }).expect(201);
      const refused = await api().post(`/announcements/${a.body.id}/publish`).set(bearer(staffToken)).expect(400);
      expect(refused.body.message).toContain('quiet hours');
      await api().patch(`/announcements/${a.body.id}`).set(bearer(staffToken)).send({ audience: 'CAREGIVERS', en: { title: 'Quiet', body: 'Night' }, sendPush: false }).expect(200);
      await api().post(`/announcements/${a.body.id}/publish`).set(bearer(staffToken)).expect(200);
      await api().delete(`/announcements/${a.body.id}`).set(bearer(staffToken)).expect(204);
    } finally {
      await api().patch('/settings/notifications').set(bearer(adminToken)).send({ quietStartHour: 21, quietEndHour: 7 }).expect(200);
    }
  });

  it('reminds about an invoice due tomorrow once, as one digest with a rejected document, and keeps to the daily cap', async () => {
    const client = await newClient();
    const sweep = app.get(ReminderSweepService);
    // Midday in Colombo today, so it is never quiet hours.
    const noon = new Date(`${colomboToday()}T06:30:00Z`);
    const due = await invoice(client.patientId, addDays(colomboToday(noon), 1));
    const due2 = await invoice(client.patientId, addDays(colomboToday(noon), 1), '900.00');

    await sweep.tick(noon);
    const reminder = await waitFor(async () => (await list(client.token).expect(200)).body.items.find((x: { category: string }) => x.category === 'REMINDER'));
    expect(reminder.title).toBe('You have 2 things to do');
    expect(reminder.path).toBe('/notifications');
    const locks = await db.select().from(reminderSends).where(eq(reminderSends.userId, client.userId));
    expect(locks.map((l) => `${l.itemKey}|${l.stage}`).sort()).toEqual(expect.arrayContaining([`invoice:${due}|DUE_SOON`, `invoice:${due2}|DUE_SOON`]));

    // Run again: nothing new.
    await sweep.tick(noon);
    await new Promise((r) => setTimeout(r, 300));
    const reminders = (await list(client.token).expect(200)).body.items.filter((x: { category: string }) => x.category === 'REMINDER');
    expect(reminders).toHaveLength(1);

    // The cap: two messages today already means a third reminder waits.
    await db.insert(reminderSends).values({ id: uuid(), userId: client.userId, itemKey: `message:${uuid()}`, stage: 'MESSAGE', sentAt: noon });
    const third = await invoice(client.patientId, addDays(colomboToday(noon), 1), '100.00');
    await sweep.tick(noon);
    await new Promise((r) => setTimeout(r, 300));
    expect((await list(client.token).expect(200)).body.items.filter((x: { category: string }) => x.category === 'REMINDER')).toHaveLength(1);
    expect(await db.select().from(reminderSends).where(and(eq(reminderSends.userId, client.userId), eq(reminderSends.itemKey, `invoice:${third}`)))).toEqual([]);
  });

  it("goes when the person's account is erased", async () => {
    const client = await newClient();
    await app.get(NotificationsService).deliver([client.userId], () => ({ title: 'a', body: 'b' }), '/notifications', 'erase test', { push: false });
    await db.insert(reminderSends).values({ id: uuid(), userId: client.userId, itemKey: 'invoice:x', stage: 'DUE_SOON' });
    expect((await db.select().from(notifications).where(eq(notifications.userId, client.userId))).length).toBe(1);
    await api().post('/me/account/deletion').set(bearer(client.token)).expect(200);
    await app.get(AccountDeletionService).eraseDue(new Date(Date.now() + 30 * 24 * HOUR));
    expect(await db.select().from(notifications).where(eq(notifications.userId, client.userId))).toEqual([]);
    expect(await db.select().from(reminderSends).where(eq(reminderSends.userId, client.userId))).toEqual([]);
  });
});
