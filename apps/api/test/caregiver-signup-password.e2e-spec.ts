import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { ThrottlerStorage } from '@nestjs/throttler';
import { eq } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { caregivers, users } from '../src/database/schema';
import { EmailService } from '../src/email/email.service';

/**
 * Caregiver sign-up finished with an email address and password instead of
 * Google, Microsoft or Facebook: set once with the token from the form,
 * confirmed by the usual verification link, then used to sign in.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};

describe('Caregiver sign-up with email and password (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  let jwt: JwtService;
  let accessSecret: string;
  const sent: { to: string; url: string }[] = [];

  const api = () => request(app.getHttpServer());
  const run = Math.floor(Date.now() / 1000) % 10_000;
  let n = 0;
  const newPhone = () => `073${String(run * 1000 + ++n).padStart(7, '0')}`;
  const newEmail = () => `signup-${run}-${++n}@example.com`;

  const register = (phone = newPhone(), extra: Record<string, unknown> = {}) =>
    api()
      .post('/auth/register-caregiver/unified')
      .send({
        phone,
        consentAccepted: true,
        fullName: 'Nadeesha Perera',
        permanentAddress: '12 Temple Road, Colombo',
        dateOfBirth: '1991-05-02',
        gender: 'FEMALE',
        civilStatus: 'SINGLE',
        emergencyContactName: 'Ruwan Perera',
        emergencyContactNumber: '0770001111',
        emergencyContactRelationship: 'Brother',
        ...extra,
      });
  const setPassword = (pendingToken: string, email: string, password = 'CaregiverPass123') =>
    api().post('/auth/register-caregiver/unified/password').send({ pendingToken, email, password });
  const login = (email: string, password = 'CaregiverPass123') => api().post('/auth/login').send({ email, password, portal: 'caregiver' });
  const tokenFrom = (url: string) => new URL(url).searchParams.get('token')!;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(unlimitedThrottle)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get<Database>(DRIZZLE);
    jwt = app.get(JwtService);
    accessSecret = app.get(ConfigService).get<string>('JWT_ACCESS_SECRET')!;
    jest.spyOn(app.get(EmailService), 'sendVerificationEmail').mockImplementation(async (to: string, url: string) => {
      sent.push({ to, url });
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('sets the email and password, asks for the address to be confirmed, then signs in with them', async () => {
    const phone = newPhone();
    const reg = await register(phone).expect(201);
    const email = newEmail();

    const res = await setPassword(reg.body.pendingToken, email.toUpperCase()).expect(200);
    expect(res.body).toEqual({ email, verificationSent: true });

    // Not before the address is confirmed.
    const early = await login(email).expect(401);
    expect(early.body.message).toMatch(/verify your email/i);

    const mail = sent.find((m) => m.to === email)!;
    expect(mail).toBeTruthy();
    await api().post('/auth/verify-email').send({ token: tokenFrom(mail.url) }).expect(201);

    const session = await login(email).expect(201);
    const claims = jwt.verify(session.body.accessToken, { secret: accessSecret }) as { role: string; caregiverId: string };
    expect(claims.role).toBe('CAREGIVER');
    const [c] = await db.select().from(caregivers).where(eq(caregivers.registrationNumber, reg.body.registrationNumber));
    expect(claims.caregiverId).toBe(c.id);
    await api().post('/auth/login').send({ email, password: 'not-the-password', portal: 'caregiver' }).expect(401);
  });

  it('works once: the same token cannot replace the password, even twice at once', async () => {
    const reg = await register().expect(201);
    const email = newEmail();
    const both = await Promise.all([setPassword(reg.body.pendingToken, email, 'FirstPass123'), setPassword(reg.body.pendingToken, email, 'SecondPass123')]);
    expect(both.map((r) => r.status).sort()).toEqual([200, 409]);

    const again = await setPassword(reg.body.pendingToken, email, 'ThirdPass123').expect(409);
    expect(again.body.message).toBe('A password is already set for this account. Sign in, or use "Forgot password?".');
  });

  it('keeps the address given on the form, and refuses one another account has', async () => {
    const formEmail = newEmail();
    const reg = await register(newPhone(), { email: formEmail }).expect(201);
    const other = await register(newPhone(), { email: newEmail() }).expect(201);
    const [otherUser] = await db.select().from(users).where(eq(users.id, (jwt.decode(other.body.pendingToken) as { sub: string }).sub));

    const taken = await setPassword(reg.body.pendingToken, otherUser.email!).expect(409);
    expect(taken.body.message).toBe('An account with this email already exists');
    const res = await setPassword(reg.body.pendingToken, formEmail).expect(200);
    expect(res.body).toEqual({ email: formEmail, verificationSent: true });
  });

  it('only takes the sign-up token, and the usual password rules', async () => {
    const reg = await register().expect(201);
    const userId = (jwt.decode(reg.body.pendingToken) as { sub: string }).sub;
    // An ordinary session token for the same person is not a sign-up token.
    const access = jwt.sign({ sub: userId, role: 'CAREGIVER' }, { secret: accessSecret, expiresIn: '10m' });
    await setPassword(access, newEmail()).expect(401);
    const expired = jwt.sign({ sub: userId, typ: 'caregiver-social-signup' }, { secret: accessSecret, expiresIn: '-1s' });
    await setPassword(expired, newEmail()).expect(401);
    await setPassword(reg.body.pendingToken, newEmail(), 'short').expect(400);
    await setPassword(reg.body.pendingToken, 'not-an-email').expect(400);
  });

  it("isn't swept away by someone registering the same number, once the address is confirmed", async () => {
    // Unconfirmed: still an abandoned sign-up, which a new registration replaces (as before).
    const phoneA = newPhone();
    const first = await register(phoneA).expect(201);
    await setPassword(first.body.pendingToken, newEmail()).expect(200);
    await register(phoneA).expect(201);

    // Confirmed: it's a real account, and the number stays taken.
    const phoneB = newPhone();
    const reg = await register(phoneB).expect(201);
    const email = newEmail();
    await setPassword(reg.body.pendingToken, email).expect(200);
    await api().post('/auth/verify-email').send({ token: tokenFrom(sent.find((m) => m.to === email)!.url) }).expect(201);
    await register(phoneB).expect(409);
    await login(email).expect(201);
  });
});
