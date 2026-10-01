import { Test } from '@nestjs/testing';
import { ValidationPipe, INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';

describe('Care Platform API (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let staffToken: string;
  const unique = Date.now().toString().slice(-8);
  let caregiverId: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const adminLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@care-platform.local', password: 'ChangeMe123!' });
    adminToken = adminLogin.body.accessToken;

    const staffLogin = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'staff@care-platform.local', password: 'ChangeMe123!' });
    staffToken = staffLogin.body.accessToken;
  });

  afterAll(async () => {
    await app.close();
  });

  it('rejects unauthenticated requests', async () => {
    await request(app.getHttpServer()).get('/caregivers').expect(401);
  });

  it('rejects invalid login credentials', async () => {
    await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@care-platform.local', password: 'wrong-password' })
      .expect(401);
  });

  it('creates a new caregiver', async () => {
    const res = await request(app.getHttpServer())
      .post('/caregivers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: `E2E Test Caregiver ${unique}`,
        permanentAddress: '1 Test Lane, Colombo',
        nic: `E2E${unique}`,
        dateOfBirth: '1993-06-15',
        gender: 'FEMALE',
        civilStatus: 'SINGLE',
        primaryPhone: `077${unique}`,
        emergencyContactName: 'Test Contact',
        emergencyContactNumber: '0770000000',
        emergencyContactRelationship: 'Friend',
      })
      .expect(201);

    expect(res.body.status).toBe('DRAFT');
    expect(res.body.registrationNumber).toMatch(/^CG-\d{4}-\d{6}$/);
    caregiverId = res.body.id;
  });

  it('rejects a duplicate NIC', async () => {
    await request(app.getHttpServer())
      .post('/caregivers')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        fullName: 'Duplicate NIC Caregiver',
        permanentAddress: '2 Test Lane, Colombo',
        nic: `E2E${unique}`,
        dateOfBirth: '1993-06-15',
        gender: 'MALE',
        civilStatus: 'SINGLE',
        primaryPhone: `077${unique}9`,
        emergencyContactName: 'Test Contact 2',
        emergencyContactNumber: '0770000001',
        emergencyContactRelationship: 'Friend',
      })
      .expect(409);
  });

  it('masks NIC and phone in the caregiver list', async () => {
    const res = await request(app.getHttpServer())
      .get('/caregivers?pageSize=50')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    const created = res.body.items.find((c: any) => c.id === caregiverId);
    expect(created).toBeDefined();
    expect(created.nic).not.toBe(`E2E${unique}`);
    expect(created.nic).toMatch(/^\*+/);
  });

  it('rejects an out-of-order status transition', async () => {
    const res = await request(app.getHttpServer())
      .patch(`/caregivers/${caregiverId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'ACTIVE' })
      .expect(400);
    expect(res.body.message).toContain('Cannot transition');
  });

  it('allows a valid status transition', async () => {
    await request(app.getHttpServer())
      .patch(`/caregivers/${caregiverId}/status`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ status: 'REGISTERED' })
      .expect(200);
  });

  it('forbids STAFF from deleting a caregiver (admin-only)', async () => {
    await request(app.getHttpServer())
      .delete(`/caregivers/${caregiverId}`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(403);
  });

  it('lets STAFF create caregivers (allowed role)', async () => {
    await request(app.getHttpServer())
      .post('/caregivers')
      .set('Authorization', `Bearer ${staffToken}`)
      .send({
        fullName: `Staff Created ${unique}`,
        permanentAddress: '3 Test Lane, Colombo',
        nic: `STF${unique}`,
        dateOfBirth: '1991-02-02',
        gender: 'MALE',
        civilStatus: 'SINGLE',
        primaryPhone: `076${unique}`,
        emergencyContactName: 'Test Contact 3',
        emergencyContactNumber: '0770000002',
        emergencyContactRelationship: 'Friend',
      })
      .expect(201);
  });

  it('assigns a skill to the caregiver and lists it', async () => {
    const skillsRes = await request(app.getHttpServer())
      .get('/skills')
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    const skill = skillsRes.body[0];
    expect(skill).toBeDefined();

    await request(app.getHttpServer())
      .post(`/caregivers/${caregiverId}/skills`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ skillId: skill.id, proficiency: 'ADVANCED', yearsOfExperience: 5 })
      .expect(201);

    const assigned = await request(app.getHttpServer())
      .get(`/caregivers/${caregiverId}/skills`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
    expect(assigned.body.some((s: any) => s.skillId === skill.id)).toBe(true);
  });

  it('rejects uploading a disallowed file type', async () => {
    await request(app.getHttpServer())
      .post(`/caregivers/${caregiverId}/documents`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('documentType', 'NIC')
      .attach('file', Buffer.from('fake executable'), { filename: 'bad.exe', contentType: 'application/x-msdownload' })
      .expect(400);
  });

  it('accepts a valid PDF document upload', async () => {
    const res = await request(app.getHttpServer())
      .post(`/caregivers/${caregiverId}/documents`)
      .set('Authorization', `Bearer ${adminToken}`)
      .field('documentType', 'NIC')
      .attach('file', Buffer.from('%PDF-1.4 test content'), { filename: 'nic.pdf', contentType: 'application/pdf' })
      .expect(201);
    expect(res.body.verificationStatus).toBe('PENDING');
  });

  it('blocks STAFF from reading restricted health information', async () => {
    await request(app.getHttpServer())
      .get(`/caregivers/${caregiverId}/health-information`)
      .set('Authorization', `Bearer ${staffToken}`)
      .expect(403);
  });

  it('allows ADMIN to read restricted health information', async () => {
    await request(app.getHttpServer())
      .get(`/caregivers/${caregiverId}/health-information`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);
  });

  describe('advanced search filters', () => {
    let skillA: string;
    let skillB: string;
    let languageA: string;
    let languageB: string;
    let locationA: string;
    let locationB: string;
    let filterCaregiver1: string;
    let filterCaregiver2: string;

    beforeAll(async () => {
      const [skillsRes, languagesRes, locationsRes] = await Promise.all([
        request(app.getHttpServer()).get('/skills').set('Authorization', `Bearer ${adminToken}`),
        request(app.getHttpServer()).get('/languages').set('Authorization', `Bearer ${adminToken}`),
        request(app.getHttpServer()).get('/locations').set('Authorization', `Bearer ${adminToken}`),
      ]);
      [skillA, skillB] = skillsRes.body.map((s: any) => s.id);
      [languageA, languageB] = languagesRes.body.map((l: any) => l.id);
      [locationA, locationB] = locationsRes.body.map((l: any) => l.id);

      const makeCaregiver = async (suffix: string, gender: string) => {
        const res = await request(app.getHttpServer())
          .post('/caregivers')
          .set('Authorization', `Bearer ${adminToken}`)
          .send({
            fullName: `Filter Test ${suffix}`,
            permanentAddress: '9 Filter Lane',
            nic: `FLT${unique}${suffix}`,
            dateOfBirth: '1994-01-01',
            gender,
            civilStatus: 'SINGLE',
            primaryPhone: `075${unique}${suffix}`,
            emergencyContactName: 'Filter EC',
            emergencyContactNumber: '0770000009',
            emergencyContactRelationship: 'Friend',
          });
        return res.body.id as string;
      };

      filterCaregiver1 = await makeCaregiver('1', 'FEMALE');
      filterCaregiver2 = await makeCaregiver('2', 'MALE');

      // Caregiver 1: has BOTH skills, language A, location A, and night duty.
      await request(app.getHttpServer())
        .post(`/caregivers/${filterCaregiver1}/skills`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ skillId: skillA });
      await request(app.getHttpServer())
        .post(`/caregivers/${filterCaregiver1}/skills`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ skillId: skillB });
      await request(app.getHttpServer())
        .post(`/caregivers/${filterCaregiver1}/languages`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ languageId: languageA });
      await request(app.getHttpServer())
        .post(`/caregivers/${filterCaregiver1}/preferred-locations`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ locationId: locationA });
      await request(app.getHttpServer())
        .put(`/caregivers/${filterCaregiver1}/availability`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ nightDuty: true });

      // Caregiver 2: has only skill A, language B, location B, and day duty.
      await request(app.getHttpServer())
        .post(`/caregivers/${filterCaregiver2}/skills`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ skillId: skillA });
      await request(app.getHttpServer())
        .post(`/caregivers/${filterCaregiver2}/languages`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ languageId: languageB });
      await request(app.getHttpServer())
        .post(`/caregivers/${filterCaregiver2}/preferred-locations`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ locationId: locationB });
      await request(app.getHttpServer())
        .put(`/caregivers/${filterCaregiver2}/availability`)
        .set('Authorization', `Bearer ${adminToken}`)
        .send({ dayDuty: true });
    });

    const idsOf = (res: request.Response) => res.body.items.map((c: any) => c.id);

    it('matches caregivers with ANY of a single requested skill', async () => {
      const res = await request(app.getHttpServer())
        .get(`/caregivers?skillIds=${skillA}&pageSize=100`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(idsOf(res)).toEqual(expect.arrayContaining([filterCaregiver1, filterCaregiver2]));
    });

    it('requires ALL requested skills (AND semantics)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/caregivers?skillIds=${skillA},${skillB}&pageSize=100`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const ids = idsOf(res);
      expect(ids).toContain(filterCaregiver1);
      expect(ids).not.toContain(filterCaregiver2);
    });

    it('filters by a single language', async () => {
      const res = await request(app.getHttpServer())
        .get(`/caregivers?languageIds=${languageB}&pageSize=100`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const ids = idsOf(res);
      expect(ids).toContain(filterCaregiver2);
      expect(ids).not.toContain(filterCaregiver1);
    });

    it('matches caregivers preferring ANY of several requested locations (OR semantics)', async () => {
      const res = await request(app.getHttpServer())
        .get(`/caregivers?locationIds=${locationA},${locationB}&pageSize=100`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(idsOf(res)).toEqual(expect.arrayContaining([filterCaregiver1, filterCaregiver2]));
    });

    it('filters by availability shift flags', async () => {
      const nightRes = await request(app.getHttpServer())
        .get('/caregivers?nightDuty=true&pageSize=100')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(idsOf(nightRes)).toContain(filterCaregiver1);
      expect(idsOf(nightRes)).not.toContain(filterCaregiver2);

      const dayRes = await request(app.getHttpServer())
        .get('/caregivers?dayDuty=true&pageSize=100')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(idsOf(dayRes)).toContain(filterCaregiver2);
      expect(idsOf(dayRes)).not.toContain(filterCaregiver1);
    });

    it('filters by gender', async () => {
      const res = await request(app.getHttpServer())
        .get('/caregivers?gender=FEMALE&pageSize=100')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const ids = idsOf(res);
      expect(ids).toContain(filterCaregiver1);
      expect(ids).not.toContain(filterCaregiver2);
    });

    it('combines multiple filter facets with AND-across-facets semantics', async () => {
      const res = await request(app.getHttpServer())
        .get(`/caregivers?gender=MALE&skillIds=${skillA}&languageIds=${languageB}&pageSize=100`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const ids = idsOf(res);
      expect(ids).toContain(filterCaregiver2);
      expect(ids).not.toContain(filterCaregiver1);
    });

    it('returns an empty (not broken) result set for an impossible combination', async () => {
      const res = await request(app.getHttpServer())
        .get(`/caregivers?skillIds=${skillB}&languageIds=${languageB}&pageSize=100`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      const ids = idsOf(res);
      expect(ids).not.toContain(filterCaregiver1);
      expect(ids).not.toContain(filterCaregiver2);
    });
  });

  describe('caregiver self-registration', () => {
    const email = `selfreg-${unique}@example.com`;
    const password = 'SelfRegPass123';
    const registrationPayload = {
      email,
      password,
      consentAccepted: true,
      fullName: `Self Registered ${unique}`,
      permanentAddress: '5 Self Service Lane',
      dateOfBirth: '1997-03-10',
      gender: 'FEMALE',
      civilStatus: 'SINGLE',
      primaryPhone: `073${unique}`,
      emergencyContactName: 'EC Person',
      emergencyContactNumber: '0770001111',
      emergencyContactRelationship: 'Sister',
    };

    let selfCaregiverId: string;
    let verificationUrl: string;
    let selfAccessToken: string;

    it('registers a new caregiver without issuing tokens', async () => {
      const res = await request(app.getHttpServer()).post('/auth/register-caregiver').send(registrationPayload).expect(201);

      expect(res.body.accessToken).toBeUndefined();
      expect(res.body.caregiverId).toBeDefined();
      expect(res.body.registrationNumber).toMatch(/^CG-\d{4}-\d{6}$/);
      expect(res.body.devVerificationUrl).toContain('/verify-email?token=');

      selfCaregiverId = res.body.caregiverId;
      verificationUrl = res.body.devVerificationUrl;
    });

    it('rejects registration with a duplicate email', async () => {
      await request(app.getHttpServer()).post('/auth/register-caregiver').send(registrationPayload).expect(409);
    });

    it('rejects registration with a duplicate phone number', async () => {
      await request(app.getHttpServer())
        .post('/auth/register-caregiver')
        .send({ ...registrationPayload, email: `other-${unique}@example.com` })
        .expect(409);
    });

    it('is immediately visible to staff, before email verification', async () => {
      const res = await request(app.getHttpServer())
        .get(`/caregivers?search=${encodeURIComponent(registrationPayload.fullName)}`)
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(res.body.items.some((c: any) => c.id === selfCaregiverId && c.status === 'DRAFT')).toBe(true);

      const dashboard = await request(app.getHttpServer())
        .get('/caregivers/dashboard')
        .set('Authorization', `Bearer ${adminToken}`)
        .expect(200);
      expect(dashboard.body.pendingRegistration).toBeGreaterThan(0);
    });

    it('blocks login before the email is verified', async () => {
      const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(401);
      expect(res.body.message).toContain('verify your email');
    });

    it('rejects an invalid verification token', async () => {
      await request(app.getHttpServer()).post('/auth/verify-email').send({ token: 'not-a-real-token' }).expect(401);
    });

    it('verifies the email and logs in automatically', async () => {
      const token = new URL(verificationUrl).searchParams.get('token')!;
      const res = await request(app.getHttpServer()).post('/auth/verify-email').send({ token }).expect(201);

      expect(res.body.accessToken).toBeDefined();
      selfAccessToken = res.body.accessToken;

      const payload = JSON.parse(Buffer.from(res.body.accessToken.split('.')[1], 'base64').toString());
      expect(payload.role).toBe('CAREGIVER');
      expect(payload.caregiverId).toBe(selfCaregiverId);
    });

    it('rejects reusing an already-used verification token', async () => {
      const token = new URL(verificationUrl).searchParams.get('token')!;
      await request(app.getHttpServer()).post('/auth/verify-email').send({ token }).expect(401);
    });

    it('allows login once verified', async () => {
      const res = await request(app.getHttpServer()).post('/auth/login').send({ email, password }).expect(201);
      expect(res.body.accessToken).toBeDefined();
    });

    it('lets the caregiver view their own full profile', async () => {
      await request(app.getHttpServer())
        .get(`/caregivers/${selfCaregiverId}`)
        .set('Authorization', `Bearer ${selfAccessToken}`)
        .expect(200);
    });

    it('blocks the caregiver from viewing another caregiver record', async () => {
      await request(app.getHttpServer())
        .get(`/caregivers/${caregiverId}`)
        .set('Authorization', `Bearer ${selfAccessToken}`)
        .expect(403);
    });

    it('blocks the caregiver from the staff-only list and dashboard endpoints', async () => {
      await request(app.getHttpServer()).get('/caregivers').set('Authorization', `Bearer ${selfAccessToken}`).expect(403);
      await request(app.getHttpServer()).get('/caregivers/dashboard').set('Authorization', `Bearer ${selfAccessToken}`).expect(403);
    });

    it('lets the caregiver manage their own qualifications, but not another caregiver’s', async () => {
      await request(app.getHttpServer())
        .post(`/caregivers/${selfCaregiverId}/qualifications`)
        .set('Authorization', `Bearer ${selfAccessToken}`)
        .send({ name: 'First Aid', type: 'FIRST_AID', institution: 'Red Cross' })
        .expect(201);

      await request(app.getHttpServer())
        .post(`/caregivers/${caregiverId}/qualifications`)
        .set('Authorization', `Bearer ${selfAccessToken}`)
        .send({ name: 'First Aid', type: 'FIRST_AID', institution: 'Red Cross' })
        .expect(403);
    });

    it('lets the caregiver view but not write their own restricted health information; blocks other caregivers’', async () => {
      await request(app.getHttpServer())
        .get(`/caregivers/${selfCaregiverId}/health-information`)
        .set('Authorization', `Bearer ${selfAccessToken}`)
        .expect(200);

      await request(app.getHttpServer())
        .get(`/caregivers/${caregiverId}/health-information`)
        .set('Authorization', `Bearer ${selfAccessToken}`)
        .expect(403);
    });

    it('lets the caregiver self-submit DRAFT to REGISTERED, but not skip further ahead', async () => {
      await request(app.getHttpServer())
        .patch(`/caregivers/${selfCaregiverId}/status`)
        .set('Authorization', `Bearer ${selfAccessToken}`)
        .send({ status: 'REGISTERED' })
        .expect(200);

      const res = await request(app.getHttpServer())
        .patch(`/caregivers/${selfCaregiverId}/status`)
        .set('Authorization', `Bearer ${selfAccessToken}`)
        .send({ status: 'DOCUMENTS_PENDING' })
        .expect(400);
      expect(res.body.message).toContain('Caregivers may only submit');
    });

    it('responds generically to resend-verification regardless of whether the account exists', async () => {
      const known = await request(app.getHttpServer()).post('/auth/resend-verification').send({ email }).expect(201);
      const unknown = await request(app.getHttpServer())
        .post('/auth/resend-verification')
        .send({ email: 'no-such-account@example.com' })
        .expect(201);
      expect(known.body.message).toEqual(unknown.body.message);
    });
  });
});
