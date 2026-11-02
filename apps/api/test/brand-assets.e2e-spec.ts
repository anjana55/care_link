import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import sharp from 'sharp';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SEED_PASSWORD } from './seed-password';

/**
 * The brand's artwork in Settings > Branding, over real HTTP and storage: an
 * admin uploads the reverse logo, symbol and app icon beside the logo; every
 * app reads which exist from GET /branding and fetches them - the mobile app
 * as PNGs, since it can't draw SVG.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};
const SYMBOL = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100" width="100" height="100"><circle cx="50" cy="50" r="40" fill="#1B8086"/></svg>');
const WIDE = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 448 92" width="448" height="92"><rect width="448" height="92" fill="#FFFFFF"/></svg>');

describe('Brand assets (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let staffToken: string;
  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const upload = (path: string, buffer: Buffer, name = 'art.svg', token = adminToken) =>
    api().post(`/settings/branding/${path}`).set(bearer(token)).attach('file', buffer, name);
  const remove = (path: string) => api().delete(`/settings/branding/${path}`).set(bearer(adminToken));

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).overrideProvider(ThrottlerStorage).useValue(unlimitedThrottle).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();
    const login = (email: string) => api().post('/auth/login').send({ email, password: SEED_PASSWORD });
    adminToken = (await login('admin@care-platform.local')).body.accessToken;
    staffToken = (await login('staff@care-platform.local')).body.accessToken;
  });

  afterAll(async () => {
    for (const path of ['logo-reverse', 'symbol', 'app-icon']) await remove(path);
    await app.close();
  });

  it('takes each asset in its own slot, and tells every app which exist', async () => {
    const before = (await api().get('/branding').expect(200)).body;
    await upload('symbol', SYMBOL).expect(201);
    await upload('logo-reverse', WIDE).expect(201);

    const after = (await api().get('/branding').expect(200)).body;
    expect(after.assets.symbol).toMatch(/^[0-9a-f]{12}$/);
    expect(after.assets.logoReverse).toMatch(/^[0-9a-f]{12}$/);
    // The logo is untouched by the others.
    expect(after.assets.logo).toBe(before.assets.logo);
    expect(after.logoVersion).toBe(before.logoVersion);

    const original = await api().get(`/branding/symbol?v=${after.assets.symbol}`).expect(200);
    expect(original.headers['content-type']).toBe('image/svg+xml');
    expect(original.headers['cache-control']).toContain('immutable');
  });

  it('draws any of them as a PNG of a listed size, for the phone', async () => {
    await upload('symbol', SYMBOL).expect(201);
    const res = await api().get('/branding/symbol?size=128').buffer(true).parse((r, cb) => {
      const chunks: Buffer[] = [];
      r.on('data', (c: Buffer) => chunks.push(c));
      r.on('end', () => cb(null, Buffer.concat(chunks)));
    }).expect(200);
    expect(res.headers['content-type']).toBe('image/png');
    expect(await sharp(res.body as Buffer).metadata()).toMatchObject({ format: 'png', width: 128, height: 128 });
    await api().get('/branding/symbol?size=4000').expect(400);
    await api().get('/branding/symbol?size=big').expect(400);
  });

  it('refuses the wrong shape, unknown slots, and anyone but an admin', async () => {
    const wrong = await upload('app-icon', WIDE).expect(400);
    expect(wrong.body.message).toBe('This picture must be square (this one is 448 × 92).');
    await upload('banner', SYMBOL).expect(404);
    await api().get('/branding/banner').expect(404);
    await upload('symbol', SYMBOL, 'art.svg', staffToken).expect(403);
    await api().post('/settings/branding/symbol').attach('file', SYMBOL, 'art.svg').expect(401);
  });

  it('forgets one when it is removed', async () => {
    await upload('app-icon', SYMBOL).expect(201);
    await remove('app-icon').expect(200);
    expect((await api().get('/branding').expect(200)).body.assets.appIcon).toBeNull();
    await api().get('/branding/app-icon').expect(404);
  });
});
