/**
 * @jest-environment node
 */
import { GET } from '@/app/.well-known/assetlinks.json/route';

/**
 * /.well-known/assetlinks.json: what Android reads to let links to the site
 * open the app. It passes on the package and fingerprints set in Settings >
 * Mobile app, and nothing else - and vouches for no app when the API is down.
 */

const FP = '14:6D:E9:83:C5:73:06:50:D8:EE:B9:95:2F:34:FC:64:16:A0:83:42:E6:1D:BE:A8:8A:04:96:B2:3F:CF:44:E5';
const STATEMENT = {
  relation: ['delegate_permission/common.handle_all_urls'],
  target: { namespace: 'android_app', package_name: 'com.vivantihealth.carelink', sha256_cert_fingerprints: [FP] },
};
const realFetch = global.fetch;
const answer = (impl: () => Promise<Response>) => {
  global.fetch = jest.fn(impl) as unknown as typeof fetch;
};
afterEach(() => {
  global.fetch = realFetch;
});

it("serves the API's app, as JSON Android can cache for a few minutes", async () => {
  answer(async () => Response.json([STATEMENT]));
  const res = await GET();
  expect(res.status).toBe(200);
  expect(res.headers.get('content-type')).toMatch(/application\/json/);
  expect(res.headers.get('cache-control')).toBe('public, max-age=300');
  expect(await res.json()).toEqual([STATEMENT]);
  expect((global.fetch as jest.Mock).mock.calls[0][0]).toBe('http://localhost:3001/public/app-links/android');
});

it('rebuilds the file from the package and fingerprints alone', async () => {
  answer(async () =>
    Response.json([{ ...STATEMENT, relation: ['delegate_permission/common.get_login_creds'], target: { ...STATEMENT.target, sha256_cert_fingerprints: [FP, 'junk'] } }]),
  );
  expect(await (await GET()).json()).toEqual([STATEMENT]);
});

it.each([
  ['the API is down', async () => Promise.reject(new Error('ECONNREFUSED'))],
  ['the API errors', async () => new Response('oops', { status: 500 })],
  ['the API errors, even with a body that looks right', async () => Response.json([STATEMENT], { status: 503 })],
  ['nothing is set', async () => Response.json([])],
  ['the answer is nonsense', async () => Response.json({ hello: 'world' })],
])('vouches for no app when %s', async (_why, impl) => {
  answer(impl as () => Promise<Response>);
  const res = await GET();
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual([]);
});
