import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { randomUUID as uuid } from 'crypto';
import { and, eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { bookingEvents, bookingShifts, bookings, caregiverReviews, caregivers, patients, reviewRequests } from '../src/database/schema';
import { ReviewRequestSweepService } from '../src/reviews/review-request-sweep.service';
import { SEED_PASSWORD } from './seed-password';

/**
 * Caregiver ratings over real HTTP: who may rate whom and until when, what the
 * public, the caregiver and staff each see, moderation, and the requests that
 * ask clients to rate.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

describe('Caregiver ratings and reviews (e2e)', () => {
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
  /** Names may hold letters only. */
  const letters = (i: number) => String.fromCharCode(65 + (i % 26)) + String.fromCharCode(97 + (Math.floor(i / 26) % 26)) + 'son';
  const newPhone = () => `076${String(run * 1000 + ++n).padStart(7, '0')}`;

  async function newCaregiver() {
    const phone = newPhone();
    const reg = await api()
      .post('/auth/register-caregiver/unified')
      .send({
        phone, consentAccepted: true, fullName: `Rated Caregiver ${phone}`, permanentAddress: '1 Lake Road, Kandy',
        dateOfBirth: '1988-01-20', gender: 'FEMALE', civilStatus: 'MARRIED', emergencyContactName: 'EC', emergencyContactNumber: '0770001111',
        emergencyContactRelationship: 'Husband',
      })
      .expect(201);
    const [row] = await db.select().from(caregivers).where(eq(caregivers.registrationNumber, reg.body.registrationNumber));
    await db.execute(sql`UPDATE caregivers SET status = 'ACTIVE', district_id = ${districtId} WHERE id = ${row.id}`);
    const token = jwt.sign({ sub: row.userId, role: 'CAREGIVER', caregiverId: row.id }, { secret: accessSecret, expiresIn: '10m' });
    return { id: row.id, publicId: row.publicId, fullName: row.fullName, token };
  }

  async function newClient() {
    const reg = await api()
      .post('/auth/register-patient')
      .send({ email: `review-client-${run}-${++n}@example.com`, password: 'SelfRegPass123', fullName: `Review Client ${letters(++n)}`, phone: newPhone(), consentAccepted: true, ...intake })
      .expect(201);
    const [row] = await db.select().from(patients).where(eq(patients.id, reg.body.patientId));
    const token = jwt.sign({ sub: row.userId, role: 'PATIENT_GUARDIAN', patientId: row.id }, { secret: accessSecret, expiresIn: '10m' });
    return { patientId: row.id, fullName: row.fullName, token };
  }

  /** A confirmed booking with the given shifts (hours from now; negative = in the past). */
  async function booking(patientId: string, caregiverId: string, shifts: { from: number; hours?: number; status?: 'SCHEDULED' | 'COMPLETED' | 'MISSED' | 'CANCELLED'; caregiverId?: string }[]) {
    const id = uuid();
    await db.insert(bookings).values({
      id, reference: `RV${run}${String(++n).padStart(4, '0')}`.slice(0, 16), patientId, caregiverId, status: 'CONFIRMED',
      scheduleType: 'DAY', daysOfWeek: '1,2,3,4,5', shiftStartTime: '08:00', shiftEndTime: '17:00', startDate: '2026-01-01', endDate: '2026-12-31',
    });
    for (const s of shifts) {
      const startsAt = new Date(Date.now() + s.from * HOUR);
      await db.insert(bookingShifts).values({
        id: uuid(), bookingId: id, caregiverId: s.caregiverId ?? caregiverId, startsAt, endsAt: new Date(startsAt.getTime() + (s.hours ?? 9) * HOUR), status: s.status ?? 'SCHEDULED',
      });
    }
    return id;
  }

  const rate = (token: string, bookingId: string, publicId: string, body: Record<string, unknown>) =>
    api().put(`/me/bookings/${bookingId}/reviews/${publicId}`).set(bearer(token)).send(body);
  const setSettings = (body: Record<string, unknown>) => api().patch('/settings/reviews').set(bearer(adminToken)).send(body);

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
    await setSettings({ enabled: true, minRatingsToShow: 3, windowDays: 90 }).expect(200);
  });

  afterAll(async () => {
    await setSettings({ enabled: true, minRatingsToShow: 3, windowDays: 90 });
    await app.close();
  });

  it('lets a client rate a caregiver only once they have worked a shift, and only on their own booking', async () => {
    const cg = await newCaregiver();
    const client = await newClient();
    const other = await newClient();
    const upcoming = await booking(client.patientId, cg.id, [{ from: 48 }, { from: -48, status: 'MISSED' }]);

    // A missed shift and a future one don't count.
    const early = await rate(client.token, upcoming, cg.publicId, { rating: 5 }).expect(404);
    expect(early.body.message).toBe('You can rate a caregiver once they have worked a shift for you');
    const list = await api().get('/me/bookings').set(bearer(client.token)).expect(200);
    expect(list.body.find((b: { id: string }) => b.id === upcoming).reviews).toEqual([]);

    const worked = await booking(client.patientId, cg.id, [{ from: -30 }, { from: 30 }]);
    // Someone else's booking reads as not found.
    await rate(other.token, worked, cg.publicId, { rating: 5 }).expect(404);
    // Staff and caregivers can't rate.
    await rate(cg.token, worked, cg.publicId, { rating: 5 }).expect(403);

    const mine = await api().get('/me/bookings').set(bearer(client.token)).expect(200);
    const entry = mine.body.find((b: { id: string }) => b.id === worked).reviews[0];
    expect(entry).toMatchObject({ caregiverPublicId: cg.publicId, isCover: false, canReview: true, review: null });
    const pending = await api().get('/me/reviews/pending').set(bearer(client.token)).expect(200);
    expect(pending.body.map((p: { bookingId: string }) => p.bookingId)).toContain(worked);

    const res = await rate(client.token, worked, cg.publicId, {
      rating: 5,
      badges: ['KIND_PATIENT', 'PUNCTUAL', 'KIND_PATIENT'],
      comment: 'Very caring with my father, always early and cheerful.',
      privateNote: 'Please thank her from us.',
    }).expect(200);
    expect(res.body.review).toMatchObject({ rating: 5, commentStatus: 'PENDING', privateNote: 'Please thank her from us.', hidden: false });
    expect(res.body.review.badges).toEqual(['PUNCTUAL', 'KIND_PATIENT']);
    const after = await api().get('/me/reviews/pending').set(bearer(client.token)).expect(200);
    expect(after.body.map((p: { bookingId: string }) => p.bookingId)).not.toContain(worked);

    const events = await db.select().from(bookingEvents).where(and(eq(bookingEvents.bookingId, worked), eq(bookingEvents.type, 'REVIEWED')));
    expect(events[0].note).toContain('5 stars');
  });

  it('validates stars, badges, tags and keeps contact details out of review text', async () => {
    const cg = await newCaregiver();
    const client = await newClient();
    const id = await booking(client.patientId, cg.id, [{ from: -30 }]);
    expect((await rate(client.token, id, cg.publicId, { rating: 6 }).expect(400)).body.message).toContain('Choose 1 to 5 stars');
    expect((await rate(client.token, id, cg.publicId, { rating: 3, badges: ['PUNCTUAL'] }).expect(400)).body.message).toBe('Badges are for 4 or 5 stars');
    expect((await rate(client.token, id, cg.publicId, { rating: 5, improvementTags: ['HYGIENE'] }).expect(400)).body.message).toBe(
      'Tell us what could be better only with 1 to 3 stars',
    );
    await rate(client.token, id, cg.publicId, { rating: 4, badges: ['NOT_A_BADGE'] }).expect(400);
    await rate(client.token, id, cg.publicId, { rating: 4, comment: 'Great job, call her on 077 123 4567 directly' }).expect(400);
    await rate(client.token, id, cg.publicId, { rating: 4, comment: 'Email me at someone@example.com please' }).expect(400);
    await rate(client.token, id, cg.publicId, { rating: 4, comment: 'Too short' }).expect(400);
    // Messages come back in the client's language.
    const si = await api().put(`/me/bookings/${id}/reviews/${cg.publicId}?lang=si`).set(bearer(client.token)).send({ rating: 3, badges: ['PUNCTUAL'] }).expect(400);
    expect(si.body.message).toBe('ලාංඡන තරු 4ක් හෝ 5ක් සඳහා පමණි');

    const low = await rate(client.token, id, cg.publicId, { rating: 2, improvementTags: ['TIMEKEEPING', 'HYGIENE'], comment: 'ප්‍රමාද වී පැමිණියා, නමුත් කාරුණිකයි.' }).expect(200);
    expect(low.body.review).toMatchObject({ rating: 2, improvementTags: ['TIMEKEEPING', 'HYGIENE'], commentStatus: 'PENDING' });
    const [row] = await db.select().from(caregiverReviews).where(eq(caregiverReviews.id, low.body.review.id));
    expect(row.commentLanguage).toBe('si');
  });

  it('lets a cover caregiver be rated separately, and closes the window after the set days', async () => {
    const booked = await newCaregiver();
    const cover = await newCaregiver();
    const client = await newClient();
    const id = await booking(client.patientId, booked.id, [{ from: -50 }, { from: -26, caregiverId: cover.id, status: 'COMPLETED' }]);
    const list = await api().get('/me/bookings').set(bearer(client.token)).expect(200);
    const reviews = list.body.find((b: { id: string }) => b.id === id).reviews;
    expect(reviews.map((r: { caregiverPublicId: string; isCover: boolean }) => [r.caregiverPublicId, r.isCover])).toEqual([
      [booked.publicId, false],
      [cover.publicId, true],
    ]);
    await rate(client.token, id, cover.publicId, { rating: 4 }).expect(200);
    await rate(client.token, id, booked.publicId, { rating: 5 }).expect(200);

    const old = await booking(client.patientId, booked.id, [{ from: -100 * 24 }]);
    const closed = await rate(client.token, old, booked.publicId, { rating: 5 }).expect(409);
    expect(closed.body.message).toBe('The time to rate this caregiver has passed');
    const view = await api().get(`/me/bookings/${old}/reviews/${booked.publicId}`).set(bearer(client.token)).expect(200);
    expect(view.body.canReview).toBe(false);
  });

  it('shows nothing publicly until enough ratings, then the average, badges and approved reviews - never the reviewer', async () => {
    const cg = await newCaregiver();
    const clients = [await newClient(), await newClient(), await newClient()];
    const ids: string[] = [];
    for (const c of clients) ids.push(await booking(c.patientId, cg.id, [{ from: -30 }]));

    await rate(clients[0].token, ids[0], cg.publicId, { rating: 5, badges: ['KIND_PATIENT', 'CLEAN_TIDY'], comment: 'Wonderful with my mother every single day.' }).expect(200);
    await rate(clients[1].token, ids[1], cg.publicId, { rating: 4, badges: ['KIND_PATIENT'] }).expect(200);

    let profile = await api().get(`/public/caregivers/${cg.publicId}?locale=en`).expect(200);
    expect(profile.body.rating).toBeNull();
    let page = await api().get(`/public/caregivers/${cg.publicId}/reviews`).expect(200);
    expect(page.body).toMatchObject({ summary: null, items: [], total: 0 });

    await rate(clients[2].token, ids[2], cg.publicId, { rating: 3, improvementTags: ['COMMUNICATION'], privateNote: 'Hard to reach by phone.' }).expect(200);
    profile = await api().get(`/public/caregivers/${cg.publicId}?locale=en`).expect(200);
    expect(profile.body.rating).toEqual({ average: 4, count: 3, topBadges: [{ badge: 'KIND_PATIENT', count: 2 }, { badge: 'CLEAN_TIDY', count: 1 }] });

    // The written review waits for staff.
    page = await api().get(`/public/caregivers/${cg.publicId}/reviews`).expect(200);
    expect(page.body.summary.count).toBe(3);
    expect(page.body.items).toEqual([]);

    const queue = await api().get(`/reviews?filter=pending&caregiverId=${cg.id}`).set(bearer(staffToken)).expect(200);
    expect(queue.body.items).toHaveLength(1);
    expect(queue.body.items[0]).toMatchObject({ clientName: clients[0].fullName, caregiverName: cg.fullName, commentStatus: 'PENDING' });
    await api().post(`/reviews/${queue.body.items[0].id}/approve-comment`).set(bearer(staffToken)).expect(200);

    page = await api().get(`/public/caregivers/${cg.publicId}/reviews?locale=en`).expect(200);
    expect(page.body.items).toHaveLength(1);
    const item = page.body.items[0];
    expect(item).toMatchObject({ rating: 5, comment: 'Wonderful with my mother every single day.', commentLanguage: 'en' });
    expect(item.reviewerDistrict).toEqual(expect.any(String));
    expect(item.month).toMatch(/^\d{4}-\d{2}$/);
    // Nothing that identifies the client, the booking, or the private parts.
    const text = JSON.stringify(page.body);
    for (const leak of [clients[0].fullName, clients[0].patientId, ids[0], 'Hard to reach', 'COMMUNICATION', 'privateNote', 'improvementTags']) expect(text).not.toContain(leak);

    // The caregiver sees their own totals and approved reviews, not the private feedback.
    const own = await api().get('/me/reviews').set(bearer(cg.token)).expect(200);
    expect(own.body).toMatchObject({ summary: { average: 4, count: 3 }, shownPublicly: true, minRatingsToShow: 3 });
    expect(own.body.reviews).toHaveLength(1);
    expect(JSON.stringify(own.body)).not.toContain('Hard to reach');

    // Staff see everything for the caregiver, private feedback included.
    const all = await api().get(`/reviews/caregivers/${cg.id}`).set(bearer(staffToken)).expect(200);
    expect(all.body.improvementCounts).toEqual([{ tag: 'COMMUNICATION', count: 1 }]);
    expect(all.body.reviews.map((r: { privateNote: string | null }) => r.privateNote)).toContain('Hard to reach by phone.');
    await api().get(`/reviews/caregivers/${cg.id}`).set(bearer(cg.token)).expect(403);
  });

  it('lets staff reject text (the client sees why) and hide a review (it stops counting and can no longer be edited)', async () => {
    const cg = await newCaregiver();
    const client = await newClient();
    const id = await booking(client.patientId, cg.id, [{ from: -30 }]);
    const given = await rate(client.token, id, cg.publicId, { rating: 1, comment: 'She never turned up on time at all.' }).expect(200);
    const reviewId = given.body.review.id;

    const low = await api().get('/reviews?filter=low').set(bearer(staffToken)).expect(200);
    expect(low.body.items.map((r: { id: string }) => r.id)).toContain(reviewId);
    expect(low.body.counts.low).toBeGreaterThan(0);

    await api().post(`/reviews/${reviewId}/reject-comment`).set(bearer(staffToken)).send({ reason: '' }).expect(400);
    await api().post(`/reviews/${reviewId}/reject-comment`).set(bearer(staffToken)).send({ reason: 'It names a different caregiver' }).expect(200);
    const seen = await api().get(`/me/bookings/${id}/reviews/${cg.publicId}`).set(bearer(client.token)).expect(200);
    expect(seen.body.review).toMatchObject({ commentStatus: 'REJECTED', commentRejectReason: 'It names a different caregiver' });

    // Unchanged text stays rejected; new text goes back for approval.
    const same = await rate(client.token, id, cg.publicId, { rating: 2, comment: 'She never turned up on time at all.' }).expect(200);
    expect(same.body.review.commentStatus).toBe('REJECTED');
    const edited = await rate(client.token, id, cg.publicId, { rating: 2, comment: 'Often late in the mornings, but kind.' }).expect(200);
    expect(edited.body.review).toMatchObject({ commentStatus: 'PENDING', commentRejectReason: null });

    await api().post(`/reviews/${reviewId}/hide`).set(bearer(staffToken)).send({ reason: 'Fake' }).expect(200);
    let own = await api().get('/me/reviews').set(bearer(cg.token)).expect(200);
    expect(own.body.summary).toBeNull();
    const blocked = await rate(client.token, id, cg.publicId, { rating: 5 }).expect(409);
    expect(blocked.body.message).toBe('Our team has hidden this review, so it cannot be changed. You can delete it.');
    await api().post(`/reviews/${reviewId}/hide`).set(bearer(staffToken)).send({ reason: 'Fake' }).expect(409);

    await api().post(`/reviews/${reviewId}/unhide`).set(bearer(staffToken)).expect(200);
    own = await api().get('/me/reviews').set(bearer(cg.token)).expect(200);
    expect(own.body.summary).toEqual({ average: 2, count: 1 });

    await api().delete(`/me/bookings/${id}/reviews/${cg.publicId}`).set(bearer(client.token)).expect(204);
    own = await api().get('/me/reviews').set(bearer(cg.token)).expect(200);
    expect(own.body.summary).toBeNull();
    await api().delete(`/me/bookings/${id}/reviews/${cg.publicId}`).set(bearer(client.token)).expect(404);
  });

  it('puts the rating on search cards and lets admins change the threshold or switch ratings off', async () => {
    const cg = await newCaregiver();
    const client = await newClient();
    const id = await booking(client.patientId, cg.id, [{ from: -30 }]);
    await rate(client.token, id, cg.publicId, { rating: 5, badges: ['TRUSTWORTHY'] }).expect(200);

    await api().patch('/settings/reviews').set(bearer(staffToken)).send({ minRatingsToShow: 1 }).expect(403);
    await setSettings({ minRatingsToShow: 0 }).expect(400);
    await setSettings({ minRatingsToShow: 1 }).expect(200);

    const search = await api()
      .post('/public/search')
      .send({ careType: 'HOME_SHIFT', location: { districtId }, desiredStartDate: new Date(Date.now() + 60 * DAY).toISOString().slice(0, 10), page: 1, pageSize: 50 })
      .expect(200);
    const card = search.body.items.find((i: { publicId: string }) => i.publicId === cg.publicId);
    expect(card?.rating).toEqual({ average: 5, count: 1, topBadges: [{ badge: 'TRUSTWORTHY', count: 1 }] });

    await setSettings({ enabled: false }).expect(200);
    expect((await api().get(`/public/caregivers/${cg.publicId}`).expect(200)).body.rating).toBeNull();
    const off = await rate(client.token, id, cg.publicId, { rating: 4 }).expect(409);
    expect(off.body.message).toBe('Ratings are switched off at the moment');
    expect((await api().get('/me/reviews/pending').set(bearer(client.token)).expect(200)).body).toEqual([]);
    await setSettings({ enabled: true, minRatingsToShow: 3 }).expect(200);
  });

  it('asks the client to rate once, reminds once, and never again', async () => {
    const cg = await newCaregiver();
    const client = await newClient();
    const done = await booking(client.patientId, cg.id, [{ from: -30 }]);
    // Still working, but only since yesterday: not yet.
    const ongoing = await booking(client.patientId, cg.id, [{ from: -20 }, { from: 30 }]);
    const sweep = app.get(ReviewRequestSweepService);
    const asked = async (bookingId: string) => (await db.select().from(reviewRequests).where(eq(reviewRequests.bookingId, bookingId))).map((r) => r.stage).sort();

    const now = new Date();
    await sweep.run(now, 90);
    expect(await asked(done)).toEqual(['ASK']);
    expect(await asked(ongoing)).toEqual([]);
    await sweep.run(now, 90);
    expect(await asked(done)).toEqual(['ASK']);

    await sweep.run(new Date(now.getTime() + 2 * DAY), 90);
    expect(await asked(done)).toEqual(['ASK']);
    await sweep.run(new Date(now.getTime() + 3 * DAY + HOUR), 90);
    expect(await asked(done)).toEqual(['ASK', 'REMINDER']);
    await sweep.run(new Date(now.getTime() + 6 * DAY), 90);
    expect(await asked(done)).toEqual(['ASK', 'REMINDER']);

    // A long booking is asked about after the first week, even while it carries on.
    const long = await booking(client.patientId, cg.id, [{ from: -8 * 24 }, { from: -30 }, { from: 30 }]);
    await sweep.run(new Date(), 90);
    expect(await asked(long)).toEqual(['ASK']);

    // Rated: nothing more.
    const rated = await booking(client.patientId, cg.id, [{ from: -30 }]);
    await rate(client.token, rated, cg.publicId, { rating: 5 }).expect(200);
    await sweep.run(new Date(), 90);
    expect(await asked(rated)).toEqual([]);
  });
});
