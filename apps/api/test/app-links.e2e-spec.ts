import { Test } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { ThrottlerStorage } from '@nestjs/throttler';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { SEED_PASSWORD } from './seed-password';

/**
 * Android app links, over real HTTP against the real database: an admin sets
 * the app's package and signing fingerprints under Settings > Mobile app, and
 * the public answer the website serves as /.well-known/assetlinks.json names
 * them - and nothing until both are set.
 */

const unlimitedThrottle = {
  increment: async () => ({ totalHits: 1, timeToExpire: 0, isBlocked: false, timeToBlockExpire: 0 }),
};
const FINGERPRINT = '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5';
const PLAY_FINGERPRINT = 'FA:C6:17:45:DC:09:03:78:6F:B9:ED:E6:2A:96:2B:39:9F:73:48:F0:BB:6F:89:9B:83:32:66:75:91:03:3B:9C';

describe('Android app links (e2e)', () => {
  let app: INestApplication;
  let adminToken: string;
  let staffToken: string;
  let before: unknown;

  const api = () => request(app.getHttpServer());
  const bearer = (t: string) => ({ Authorization: `Bearer ${t}` });
  const save = (body: object, token = adminToken) => api().patch('/settings/mobile-app').set(bearer(token)).send(body);
  const assetLinks = () => api().get('/public/app-links/android');

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(ThrottlerStorage)
      .useValue(unlimitedThrottle)
      .compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true }));
    await app.init();

    const login = (email: string) => api().post('/auth/login').send({ email, password: SEED_PASSWORD });
    adminToken = (await login('admin@care-platform.local')).body.accessToken;
    staffToken = (await login('staff@care-platform.local')).body.accessToken;
    expect(adminToken && staffToken).toBeTruthy();
    before = (await api().get('/settings/mobile-app').set(bearer(adminToken)).expect(200)).body.appLinks;
    await save({ appLinks: { android: { packageName: '', certFingerprints: [] } } }).expect(200);
  });

  afterAll(async () => {
    const b = before as { android: { packageName: string | null; certFingerprints: string[] } };
    await save({ appLinks: { android: { packageName: b.android.packageName ?? '', certFingerprints: b.android.certFingerprints } } });
    await app.close();
  });

  it('vouches for no app until both the package and a fingerprint are set', async () => {
    expect((await assetLinks().expect(200)).body).toEqual([]);
    await save({ appLinks: { android: { packageName: 'com.vivantihealth.carelink' } } }).expect(200);
    expect((await assetLinks().expect(200)).body).toEqual([]);
  });

  it('publishes what the admin saved, in the form Android reads, to anyone', async () => {
    // Pasted as `keytool` and Play Console print them, or lower case without colons.
    const saved = await save({
      appLinks: { android: { packageName: ' com.vivantihealth.carelink ', certFingerprints: [FINGERPRINT, PLAY_FINGERPRINT.replace(/:/g, '').toLowerCase(), FINGERPRINT] } },
    }).expect(200);
    expect(saved.body.appLinks.android).toEqual({ packageName: 'com.vivantihealth.carelink', certFingerprints: [FINGERPRINT, PLAY_FINGERPRINT] });

    const res = await assetLinks().expect(200);
    expect(res.headers['content-type']).toMatch(/application\/json/);
    expect(res.headers['cache-control']).toBe('public, max-age=300');
    expect(res.body).toEqual([
      {
        relation: ['delegate_permission/common.handle_all_urls'],
        target: { namespace: 'android_app', package_name: 'com.vivantihealth.carelink', sha256_cert_fingerprints: [FINGERPRINT, PLAY_FINGERPRINT] },
      },
    ]);

    // Saving the version settings leaves the app links alone.
    await save({ android: { latestVersion: '' } }).expect(200);
    expect((await assetLinks().expect(200)).body[0].target.sha256_cert_fingerprints).toEqual([FINGERPRINT, PLAY_FINGERPRINT]);
  });

  it("refuses what isn't a package or a fingerprint, and keeps what was there", async () => {
    await save({ appLinks: { android: { packageName: 'com.vivantihealth.carelink', certFingerprints: [FINGERPRINT] } } }).expect(200);
    const bad = await save({ appLinks: { android: { certFingerprints: [FINGERPRINT.slice(3)] } } }).expect(400);
    expect(bad.body.message).toMatch(/isn't a SHA-256 fingerprint/);
    await save({ appLinks: { android: { packageName: 'carelink' } } }).expect(400);
    await save({ appLinks: { android: { packageName: 'com.vivantihealth.carelink', certFingerprints: 'AB' } } }).expect(400);
    expect((await assetLinks().expect(200)).body[0].target.sha256_cert_fingerprints).toEqual([FINGERPRINT]);
  });

  it('only an admin changes them', async () => {
    await save({ appLinks: { android: { packageName: 'com.attacker.app' } } }, staffToken).expect(403);
    await api().patch('/settings/mobile-app').send({ appLinks: { android: { packageName: 'com.attacker.app' } } }).expect(401);
    expect((await assetLinks().expect(200)).body[0].target.package_name).toBe('com.vivantihealth.carelink');
  });

  it('clears with an empty list', async () => {
    await save({ appLinks: { android: { certFingerprints: [] } } }).expect(200);
    expect((await assetLinks().expect(200)).body).toEqual([]);
  });
});
