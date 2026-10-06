import { api, fetchBlob } from '@/lib/api/client';

/**
 * The API answers in the language it is asked for, so the site has to ask - on
 * every call, in whatever language the visitor has switched to by now.
 */

const KEY = 'care-platform-public-locale';
const fetchMock = jest.fn();
// jsdom has no Response; the client only needs these few members of it.
const ok = () => ({ ok: true, status: 200, statusText: 'OK', headers: { get: () => 'application/json' }, json: async () => ({}), text: async () => '{}', blob: async () => new Blob(['x']) });
const headersOfLastCall = () => (fetchMock.mock.calls.at(-1)![1] as { headers: Record<string, string> }).headers;

beforeEach(() => {
  window.localStorage.clear();
  fetchMock.mockReset();
  fetchMock.mockImplementation(async () => ok());
  global.fetch = fetchMock as never;
});

describe('Accept-Language on API calls', () => {
  it('defaults to English', async () => {
    await api.get('/anything');
    expect(headersOfLastCall()['Accept-Language']).toBe('en');
  });

  it.each(['si', 'ta'])('follows the language the visitor chose (%s)', async (code) => {
    window.localStorage.setItem(KEY, code);
    await api.get('/anything');
    expect(headersOfLastCall()['Accept-Language']).toBe(code);
  });

  it('follows a change made after the first call, without a reload', async () => {
    await api.get('/a');
    window.localStorage.setItem(KEY, 'ta');
    await api.post('/b', {});
    expect(headersOfLastCall()['Accept-Language']).toBe('ta');
  });

  it('falls back to English for a value it does not recognise', async () => {
    window.localStorage.setItem(KEY, 'klingon');
    await api.get('/anything');
    expect(headersOfLastCall()['Accept-Language']).toBe('en');
  });

  it('is sent on file uploads too, without breaking the multipart content type', async () => {
    window.localStorage.setItem(KEY, 'si');
    await api.post('/upload', new FormData());
    const headers = headersOfLastCall();
    expect(headers['Accept-Language']).toBe('si');
    expect(headers['Content-Type']).toBeUndefined();
  });

  it('is sent when fetching a protected file', async () => {
    window.localStorage.setItem(KEY, 'ta');
    await fetchBlob('/file');
    expect(headersOfLastCall()['Accept-Language']).toBe('ta');
  });
});
