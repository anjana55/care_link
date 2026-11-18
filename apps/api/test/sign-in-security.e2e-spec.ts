import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { eq, sql } from 'drizzle-orm';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { DRIZZLE, type Database } from '../src/database/database.module';
import { users } from '../src/database/schema';
import { trustProxy } from '../src/common/trust-proxy';
import { LOGIN_LOCKED_MESSAGE, LOGIN_MAX_FAILURES } from '../src/auth/auth.service';

/**
 * Password sign-in under attack, with the real rate limiter and the same
 * proxy setting as main.ts:
 * - the per-address limit follows the visitor's address that nginx passes on,
 *   so one visitor using it up does not lock out the next;
 * - an account pauses after 10 wrong passwords in a row, whatever addresses
 *   the guesses come from, and a password reset ends the pause;
 * - an unknown email is refused as slowly as a wrong password.
 */
describe('Sign-in security (e2e)', () => {
  let app: INestApplication;
  let db: Database;
  const api = () => request(app.getHttpServer());
  const run = `${Date.now()}`;
  let ip = 0;
  let intake: Record<string, unknown>;
  let n = 0;
  /** A number nobody holds yet (077 is shared with other suites). */
  const freePhone = async () => {
    for (;;) {
      const p = `077${String((Number(run.slice(-5)) % 1000) * 10_000 + ++n + 8000).padStart(7, '0')}`;
      const [taken] = (await db.execute(sql`SELECT id FROM users WHERE phone = ${`+94${p.slice(1)}`} LIMIT 1`)) as unknown as [unknown[]];
      if (!taken.length) return p;
    }
  };
  /** A different visitor address each time (TEST-NET-3 range). */
  const fromNewAddress = () => `203.0.113.${(++ip % 250) + 1}`;

  async function account(): Promise<{ email: string; password: string; id: string }> {
    const email = `lockout-${run}-${++ip}@example.com`;
    const password = 'RightPassword123';
    await api()
      .post('/auth/register-patient')
      .set('X-Forwarded-For', fromNewAddress())
      .send({ email, password, fullName: 'Lock Test', phone: await freePhone(), consentAccepted: true, ...intake })
      .expect(201);
    const [u] = await db.select({ id: users.id }).from(users).where(eq(users.email, email));
    await db.update(users).set({ emailVerifiedAt: new Date() }).where(eq(users.id, u.id));
    return { email, password, id: u.id };
  }
  const login = (email: string, password: string, from = fromNewAddress()) =>
    api().post('/auth/login').set('X-Forwarded-For', from).send({ email, password, portal: 'customer' });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>();
    (app as NestExpressApplication).set('trust proxy', trustProxy(undefined));
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    db = app.get<Database>(DRIZZLE);
    const tree = (await api().get('/public/meta/locations/tree?locale=en').expect(200)).body as { districts: { id: number }[] }[];
    const districtId = tree.flatMap((p) => p.districts)[2].id;
    const cityId = (await api().get(`/public/meta/locations/cities?districtId=${districtId}&locale=en`).expect(200)).body[0].id;
    intake = {
      registrantType: 'SELF', recipientName: 'Lock Test', recipientRelationship: 'SELF', recipientAge: 60, recipientGender: 'MALE',
      preferredContactMethod: 'PHONE_CALL', districtId, cityId, careNeeds: 'Help at home a few days a week.', careSchedule: 'DAY', careStart: 'WITHIN_WEEK',
    };
  });

  afterAll(async () => {
    await app?.close();
  });

  it('limits sign-in per visitor address, not for the whole site', async () => {
    const one = fromNewAddress();
    for (let i = 0; i < 10; i++) await login(`nobody-${run}@example.com`, 'wrong-password', one).expect(401);
    await login(`nobody-${run}@example.com`, 'wrong-password', one).expect(429);
    // Someone else, behind the same nginx, is not affected.
    await login(`nobody-${run}@example.com`, 'wrong-password', fromNewAddress()).expect(401);
    // And a visitor cannot dodge the limit by writing an address in the header:
    // nginx appends the real one last, and that is the one used.
    await login(`nobody-${run}@example.com`, 'wrong-password', `198.51.100.7, ${one}`).expect(429);
  }, 60_000);

  it('pauses an account after 10 wrong passwords, even spread over many addresses, until it is reset or the time passes', async () => {
    const a = await account();
    for (let i = 0; i < LOGIN_MAX_FAILURES - 1; i++) await login(a.email, 'wrong-password').expect(401);
    // Nine wrong, then the right one: in, and the count starts again.
    await login(a.email, a.password).expect(201);
    for (let i = 0; i < LOGIN_MAX_FAILURES; i++) await login(a.email, 'wrong-password').expect(401);
    // Now paused, even with the right password, from a fresh address.
    const locked = await login(a.email, a.password).expect(429);
    expect(locked.body.message).toBe(LOGIN_LOCKED_MESSAGE);
    // Translated like every other message.
    const si = await api().post('/auth/login?lang=si').set('X-Forwarded-For', fromNewAddress()).send({ email: a.email, password: a.password, portal: 'customer' }).expect(429);
    expect(si.body.message).not.toBe(LOGIN_LOCKED_MESSAGE);
    // The pause ends on its own.
    await db.update(users).set({ loginLockedUntil: new Date(Date.now() - 1000) }).where(eq(users.id, a.id));
    await login(a.email, a.password).expect(201);
    const [row] = await db.select({ failedLogins: users.failedLogins, loginLockedUntil: users.loginLockedUntil }).from(users).where(eq(users.id, a.id));
    expect(row).toEqual({ failedLogins: 0, loginLockedUntil: null });
  }, 120_000);

  it('counts every guess sent at once', async () => {
    const a = await account();
    await Promise.all(Array.from({ length: LOGIN_MAX_FAILURES }, () => login(a.email, 'wrong-password')));
    await login(a.email, a.password).expect(429);
  }, 60_000);

  it('takes as long to refuse an unknown email as a wrong password', async () => {
    const a = await account();
    const time = async (email: string) => {
      const t = process.hrtime.bigint();
      await login(email, 'wrong-password').expect(401);
      return Number(process.hrtime.bigint() - t) / 1e6;
    };
    const median = (xs: number[]) => xs.sort((x, y) => x - y)[Math.floor(xs.length / 2)];
    const known: number[] = [];
    const unknown: number[] = [];
    for (let i = 0; i < 4; i++) {
      known.push(await time(a.email));
      unknown.push(await time(`no-such-${run}-${i}@example.com`));
    }
    // Both run the full password check (~100 ms or more); before, an unknown email took a few ms.
    expect(median(unknown)).toBeGreaterThan(median(known) * 0.5);
    await db.execute(sql`UPDATE users SET failed_logins = 0 WHERE id = ${a.id}`);
  }, 60_000);
});
