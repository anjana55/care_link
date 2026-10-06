import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { caregivers, caregiverDocuments, qualifications, experiences } from '../src/database/schema';
import { SEED_PASSWORD } from './seed-password';

/**
 * What a logged-in caregiver can and cannot do to their own record, over real
 * HTTP against the real database: edit their profile, manage documents, set
 * their shift availability, add qualifications and experience.
 *
 * The security-relevant half matters as much as the happy path - each of these
 * endpoints used to be reachable only by trusted staff, so each one now has to
 * hold when the caller is a self-registered member of the public.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

const PDF = Buffer.from('%PDF-1.4\n1 0 obj\n<<>>\nendobj\n');
const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('rest')]);

describe('Caregiver portal API (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let jwt: JwtService;
  let accessSecret: string;
  let adminToken: string;
  let verifierToken: string;
  let a: { id: string; token: string };
  let b: { id: string; token: string };

  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const run = Math.floor(Date.now() / 1000) % 10_000;
  let n = 0;

  async function newCaregiver(): Promise<{ id: string; token: string }> {
    const phone = `077${String(run * 1000 + ++n).padStart(7, '0')}`;
    const reg = await api()
      .post('/auth/register-caregiver/unified')
      .send({
        phone,
        consentAccepted: true,
        fullName: `Portal Caregiver ${phone}`,
        permanentAddress: '12 Temple Road, Colombo',
        dateOfBirth: '1992-06-15',
        gender: 'FEMALE',
        civilStatus: 'SINGLE',
        emergencyContactName: 'EC Person',
        emergencyContactNumber: '0770001111',
        emergencyContactRelationship: 'Sister',
      })
      .expect(201);
    // Looked up by registration number: the phone is stored in normalised form.
    const [row] = await db.select().from(caregivers).where(eq(caregivers.registrationNumber, reg.body.registrationNumber));
    // A session as the self-registered caregiver would hold it. Signed directly
    // because the sign-in routes are covered by their own suites.
    const token = jwt.sign({ sub: row.userId, role: 'CAREGIVER', caregiverId: row.id }, { secret: accessSecret, expiresIn: '10m' });
    return { id: row.id, token };
  }

  const setStatus = (id: string, status: string) => db.execute(sql`UPDATE caregivers SET status = ${status} WHERE id = ${id}`);

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(unlimitedThrottle)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get<Database>(DRIZZLE);
    accessSecret = app.get(ConfigService).get<string>('JWT_ACCESS_SECRET')!;
    jwt = new JwtService({});

    adminToken = (await api().post('/auth/login').send({ email: 'admin@care-platform.local', password: SEED_PASSWORD })).body.accessToken;
    verifierToken = (await api().post('/auth/login').send({ email: 'verifier@care-platform.local', password: SEED_PASSWORD })).body.accessToken;
    expect(adminToken).toBeDefined();
    expect(verifierToken).toBeDefined();
    a = await newCaregiver();
    b = await newCaregiver();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('own record only', () => {
    it('reads their own record but not another caregiver\'s', async () => {
      await api().get(`/caregivers/${a.id}`).set(bearer(a.token)).expect(200);
      await api().get(`/caregivers/${b.id}`).set(bearer(a.token)).expect(403);
      await api().get(`/caregivers/${b.id}/documents`).set(bearer(a.token)).expect(403);
      await api().get(`/caregivers/${b.id}/availability`).set(bearer(a.token)).expect(403);
    });
  });

  describe('profile', () => {
    it('lets a caregiver correct their own details', async () => {
      const res = await api()
        .patch(`/caregivers/${a.id}/profile`)
        .set(bearer(a.token))
        .send({ permanentAddress: '99 New Road, Kandy', emergencyContactName: 'New Contact', heightIn: 63.5, weightKg: 58 })
        .expect(200);
      expect(res.body).toMatchObject({ permanentAddress: '99 New Road, Kandy', emergencyContactName: 'New Contact' });
    });

    it('validates what it is sent, with the same rules staff face', async () => {
      await api().patch(`/caregivers/${a.id}/profile`).set(bearer(a.token)).send({ permanentAddress: 'x' }).expect(400);
      await api().patch(`/caregivers/${a.id}/profile`).set(bearer(a.token)).send({ gender: 'ROBOT' }).expect(400);
    });

    it('cannot change status, ownership, login phone or anything outside the allowlist', async () => {
      const [before] = await db.select().from(caregivers).where(eq(caregivers.id, a.id));
      await api()
        .patch(`/caregivers/${a.id}/profile`)
        .set(bearer(a.token))
        .send({ status: 'VERIFIED', userId: 'someone-else', primaryPhone: '0779999999', registrationNumber: 'CG-0000', permanentAddress: '100 Another Road' })
        .expect(200);
      const [after] = await db.select().from(caregivers).where(eq(caregivers.id, a.id));
      expect(after.status).toBe(before.status);
      expect(after.userId).toBe(before.userId);
      expect(after.primaryPhone).toBe(before.primaryPhone);
      expect(after.registrationNumber).toBe(before.registrationNumber);
      expect(after.permanentAddress).toBe('100 Another Road');
    });

    it('cannot edit another caregiver\'s profile', async () => {
      await api().patch(`/caregivers/${b.id}/profile`).set(bearer(a.token)).send({ permanentAddress: 'hijacked address' }).expect(403);
    });

    it('locks identity fields once verification has started, but not contact details', async () => {
      const c = await newCaregiver();
      await setStatus(c.id, 'UNDER_VERIFICATION');

      const locked = await api().patch(`/caregivers/${c.id}/profile`).set(bearer(c.token)).send({ fullName: 'A Different Name' }).expect(403);
      expect(locked.body.message).toMatch(/locked/i);
      await api().patch(`/caregivers/${c.id}/profile`).set(bearer(c.token)).send({ gender: 'MALE' }).expect(403);

      // Re-sending what is already there (a form that submits every field) is not a change.
      const [row] = await db.select().from(caregivers).where(eq(caregivers.id, c.id));
      await api().patch(`/caregivers/${c.id}/profile`).set(bearer(c.token)).send({ fullName: row.fullName, permanentAddress: '5 Moved Lane' }).expect(200);
      await api().patch(`/caregivers/${c.id}/profile`).set(bearer(c.token)).send({ secondaryPhone: '0112223334' }).expect(200);
    });

    it('still lets staff edit the record through the staff endpoint', async () => {
      await api().patch(`/caregivers/${a.id}`).set(bearer(adminToken)).send({ fullName: 'Staff Corrected Name' }).expect(200);
      await api().patch(`/caregivers/${a.id}`).set(bearer(a.token)).send({ fullName: 'x'.repeat(10) }).expect(403);
    });

    it('can submit the registration, and nothing further', async () => {
      const c = await newCaregiver();
      await api().patch(`/caregivers/${c.id}/status`).set(bearer(c.token)).send({ status: 'REGISTERED' }).expect(200);
      await api().patch(`/caregivers/${c.id}/status`).set(bearer(c.token)).send({ status: 'VERIFIED' }).expect(400);
    });
  });

  describe('documents', () => {
    const upload = (token: string, id: string, file: Buffer, filename: string, contentType: string, type = 'NIC') =>
      api().post(`/caregivers/${id}/documents`).set(bearer(token)).field('documentType', type).attach('file', file, { filename, contentType });

    it('uploads, lists and opens their own documents', async () => {
      const up = await upload(a.token, a.id, PDF, 'nic.pdf', 'application/pdf').expect(201);
      expect(up.body.verificationStatus).toBe('PENDING');

      const list = await api().get(`/caregivers/${a.id}/documents`).set(bearer(a.token)).expect(200);
      expect(list.body.map((d: any) => d.id)).toContain(up.body.id);
      expect(JSON.stringify(list.body)).not.toContain('storageKey');

      const file = await api().get(`/caregivers/${a.id}/documents/${up.body.id}/file`).set(bearer(a.token)).expect(200);
      expect(file.headers['content-type']).toMatch(/application\/pdf/);
    });

    it('cannot read another caregiver\'s document, even with a valid id', async () => {
      const theirs = await upload(b.token, b.id, PNG, 'nic.png', 'image/png').expect(201);
      await api().get(`/caregivers/${b.id}/documents/${theirs.body.id}/file`).set(bearer(a.token)).expect(403);
      // Their own scope with someone else's document id finds nothing.
      await api().get(`/caregivers/${a.id}/documents/${theirs.body.id}/file`).set(bearer(a.token)).expect(404);
    });

    it('rejects a file whose content is not what its name and type claim', async () => {
      const res = await upload(a.token, a.id, Buffer.from('<html><script>alert(1)</script></html>'), 'nic.pdf', 'application/pdf').expect(400);
      expect(res.body.message).toMatch(/does not match/i);
      await upload(a.token, a.id, PDF, 'nic.exe', 'application/pdf').expect(400);
      await upload(a.token, a.id, PDF, 'nic.pdf', 'text/html').expect(400);
    });

    it('rejects a request with no file', async () => {
      await api().post(`/caregivers/${a.id}/documents`).set(bearer(a.token)).field('documentType', 'NIC').expect(400);
    });

    it('lets a caregiver withdraw a pending or rejected document but not one under or past verification', async () => {
      const doc = (await upload(a.token, a.id, PDF, 'cert.pdf', 'application/pdf', 'CAREGIVER_CERTIFICATE').expect(201)).body;

      await api().patch(`/caregivers/${a.id}/documents/${doc.id}/verification`).set(bearer(verifierToken)).send({ status: 'VERIFIED' }).expect(200);
      const blocked = await api().delete(`/caregivers/${a.id}/documents/${doc.id}`).set(bearer(a.token)).expect(403);
      expect(blocked.body.message).toMatch(/only staff/i);

      await api().patch(`/caregivers/${a.id}/documents/${doc.id}/verification`).set(bearer(verifierToken)).send({ status: 'IN_PROGRESS' }).expect(200);
      await api().delete(`/caregivers/${a.id}/documents/${doc.id}`).set(bearer(a.token)).expect(403);

      await api().patch(`/caregivers/${a.id}/documents/${doc.id}/verification`).set(bearer(verifierToken)).send({ status: 'REJECTED' }).expect(200);
      await api().delete(`/caregivers/${a.id}/documents/${doc.id}`).set(bearer(a.token)).expect(200);
      expect(await db.select().from(caregiverDocuments).where(eq(caregiverDocuments.id, doc.id))).toHaveLength(0);
    });

    it('cannot delete another caregiver\'s document, and cannot verify its own', async () => {
      const theirs = (await upload(b.token, b.id, PDF, 'x.pdf', 'application/pdf').expect(201)).body;
      await api().delete(`/caregivers/${b.id}/documents/${theirs.id}`).set(bearer(a.token)).expect(403);
      const own = (await upload(a.token, a.id, PDF, 'y.pdf', 'application/pdf').expect(201)).body;
      await api().patch(`/caregivers/${a.id}/documents/${own.id}/verification`).set(bearer(a.token)).send({ status: 'VERIFIED' }).expect(403);
    });

    it('stops at a sensible number of documents per caregiver', async () => {
      const c = await newCaregiver();
      for (let i = 0; i < 20; i++) await upload(c.token, c.id, PDF, `d${i}.pdf`, 'application/pdf', 'OTHER').expect(201);
      const res = await upload(c.token, c.id, PDF, 'one-too-many.pdf', 'application/pdf', 'OTHER').expect(400);
      expect(res.body.message).toMatch(/at most 20/);
    });
  });

  describe('shift availability', () => {
    it('saves and reads back their own availability', async () => {
      const put = await api()
        .put(`/caregivers/${a.id}/availability`)
        .set(bearer(a.token))
        .send({ dayDuty: true, nightDuty: false, liveIn24h: true, preferredShift: 'DAY', availableFrom: '2026-11-01', expectedDailyRate: '6500', expectedLeaveDays: 4, preferredLeavePattern: 'Weekends' })
        .expect(200);
      expect(put.body).toMatchObject({ dayDuty: true, nightDuty: false, liveIn24h: true, preferredShift: 'DAY', expectedLeaveDays: 4 });

      const get = await api().get(`/caregivers/${a.id}/availability`).set(bearer(a.token)).expect(200);
      expect(get.body.preferredLeavePattern).toBe('Weekends');
    });

    it('updates in place rather than adding a second row', async () => {
      await api().put(`/caregivers/${a.id}/availability`).set(bearer(a.token)).send({ nightDuty: true }).expect(200);
      const get = await api().get(`/caregivers/${a.id}/availability`).set(bearer(a.token)).expect(200);
      expect(get.body).toMatchObject({ nightDuty: true, dayDuty: true });
    });

    it('rejects values the form could never send', async () => {
      await api().put(`/caregivers/${a.id}/availability`).set(bearer(a.token)).send({ preferredShift: 'WHENEVER' }).expect(400);
      await api().put(`/caregivers/${a.id}/availability`).set(bearer(a.token)).send({ expectedDailyRate: 'lots' }).expect(400);
      await api().put(`/caregivers/${a.id}/availability`).set(bearer(a.token)).send({ availableFrom: 'tomorrow-ish' }).expect(400);
    });

    it('cannot change another caregiver\'s availability', async () => {
      await api().put(`/caregivers/${b.id}/availability`).set(bearer(a.token)).send({ dayDuty: false }).expect(403);
    });
  });

  describe('qualifications and experience', () => {
    const qual = { name: 'NVQ Level 3 Caregiving', type: 'NVQ', institution: 'Vocational Training Authority' };
    const exp = { employerOrClient: 'Private household', role: 'Elder care', country: 'Sri Lanka', startDate: '2022-01-01' };

    it('adds and edits their own entries', async () => {
      const q = (await api().post(`/caregivers/${a.id}/qualifications`).set(bearer(a.token)).send(qual).expect(201)).body;
      const edited = await api().patch(`/caregivers/${a.id}/qualifications/${q.id}`).set(bearer(a.token)).send({ institution: 'Another Institute' }).expect(200);
      expect(edited.body.institution).toBe('Another Institute');
      await api().post(`/caregivers/${a.id}/experiences`).set(bearer(a.token)).send(exp).expect(201);
    });

    it('cannot mark their own qualification or experience verified by editing it', async () => {
      const q = (await api().post(`/caregivers/${a.id}/qualifications`).set(bearer(a.token)).send(qual).expect(201)).body;
      await api().patch(`/caregivers/${a.id}/qualifications/${q.id}`).set(bearer(a.token)).send({ verificationStatus: 'VERIFIED' }).expect(200);
      const [qRow] = await db.select().from(qualifications).where(eq(qualifications.id, q.id));
      expect(qRow.verificationStatus).toBe('PENDING');

      const e = (await api().post(`/caregivers/${a.id}/experiences`).set(bearer(a.token)).send(exp).expect(201)).body;
      await api().patch(`/caregivers/${a.id}/experiences/${e.id}`).set(bearer(a.token)).send({ verificationStatus: 'VERIFIED' }).expect(200);
      const [eRow] = await db.select().from(experiences).where(eq(experiences.id, e.id));
      expect(eRow.verificationStatus).toBe('PENDING');
    });

    it('cannot move an entry to another caregiver by editing it', async () => {
      const q = (await api().post(`/caregivers/${a.id}/qualifications`).set(bearer(a.token)).send(qual).expect(201)).body;
      await api().patch(`/caregivers/${a.id}/qualifications/${q.id}`).set(bearer(a.token)).send({ caregiverId: b.id }).expect(200);
      const [row] = await db.select().from(qualifications).where(eq(qualifications.id, q.id));
      expect(row.caregiverId).toBe(a.id);
    });

    it('sends a verified entry back to pending when the caregiver changes it, and keeps staff edits as they were', async () => {
      const q = (await api().post(`/caregivers/${a.id}/qualifications`).set(bearer(a.token)).send(qual).expect(201)).body;
      await api().patch(`/caregivers/${a.id}/qualifications/${q.id}/verification`).set(bearer(verifierToken)).send({ status: 'VERIFIED' }).expect(200);

      await api().patch(`/caregivers/${a.id}/qualifications/${q.id}`).set(bearer(a.token)).send({ name: 'Changed after verification' }).expect(200);
      expect((await db.select().from(qualifications).where(eq(qualifications.id, q.id)))[0].verificationStatus).toBe('PENDING');

      await api().patch(`/caregivers/${a.id}/qualifications/${q.id}/verification`).set(bearer(verifierToken)).send({ status: 'VERIFIED' }).expect(200);
      await api().patch(`/caregivers/${a.id}/qualifications/${q.id}`).set(bearer(adminToken)).send({ certificateNumber: 'C-123' }).expect(200);
      expect((await db.select().from(qualifications).where(eq(qualifications.id, q.id)))[0].verificationStatus).toBe('VERIFIED');
    });

    it('cannot verify entries, can withdraw unchecked ones but not verified ones, and cannot touch another caregiver\'s', async () => {
      const q = (await api().post(`/caregivers/${a.id}/qualifications`).set(bearer(a.token)).send(qual).expect(201)).body;
      await api().patch(`/caregivers/${a.id}/qualifications/${q.id}/verification`).set(bearer(a.token)).send({ status: 'VERIFIED' }).expect(403);
      await api().post(`/caregivers/${b.id}/qualifications`).set(bearer(a.token)).send(qual).expect(403);

      await api().patch(`/caregivers/${a.id}/qualifications/${q.id}/verification`).set(bearer(verifierToken)).send({ status: 'VERIFIED' }).expect(200);
      await api().delete(`/caregivers/${a.id}/qualifications/${q.id}`).set(bearer(a.token)).expect(403);
      await api().patch(`/caregivers/${a.id}/qualifications/${q.id}/verification`).set(bearer(verifierToken)).send({ status: 'REJECTED' }).expect(200);
      await api().delete(`/caregivers/${a.id}/qualifications/${q.id}`).set(bearer(a.token)).expect(200);

      const pending = (await api().post(`/caregivers/${a.id}/experiences`).set(bearer(a.token)).send(exp).expect(201)).body;
      await api().delete(`/caregivers/${a.id}/experiences/${pending.id}`).set(bearer(a.token)).expect(200);
      const theirs = (await api().post(`/caregivers/${b.id}/experiences`).set(bearer(b.token)).send(exp).expect(201)).body;
      await api().delete(`/caregivers/${b.id}/experiences/${theirs.id}`).set(bearer(a.token)).expect(403);
    });
  });
});
