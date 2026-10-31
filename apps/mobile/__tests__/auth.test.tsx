import { act, render, screen } from '@testing-library/react-native';
import { Text } from 'react-native';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { createApiClient } from '@/api/client';
import { json, memoryTokens, tokensFor } from '../test-utils/helpers';

type Auth = ReturnType<typeof useAuth>;

async function mount(initial: ReturnType<typeof tokensFor> | null, respond: (url: string) => Response | Promise<Response> = () => json(200, {})) {
  const tokens = memoryTokens(initial);
  const fetch = jest.fn(async (url: string) => respond(url));
  let expire: () => void = () => undefined;
  const api = createApiClient({ baseUrl: 'https://api.test', tokens, language: () => 'en', fetch: fetch as never, onSessionExpired: () => expire() });
  let auth!: Auth;
  function Probe() {
    auth = useAuth();
    return <Text>{auth.ready ? (auth.user ? `user:${auth.user.role}` : 'signed-out') : 'loading'}</Text>;
  }
  await render(
    <AuthProvider api={api} tokens={tokens} subscribeExpired={(l) => ((expire = l), () => undefined)}>
      <Probe />
    </AuthProvider>,
  );
  await screen.findByText(/user:|signed-out/);
  return { tokens, fetch, auth: () => auth, expire: () => act(async () => expire()) };
}

describe('session on the phone', () => {
  it('restores a saved caregiver or client session', async () => {
    await mount(tokensFor('PATIENT_GUARDIAN', { patientId: 'p-1' }));
    expect(screen.getByText('user:PATIENT_GUARDIAN')).toBeTruthy();
  });

  it.each(['ADMIN', 'STAFF', 'VERIFIER', 'EMPLOYER'])('clears a saved %s session - not an app account', async (role) => {
    const { tokens } = await mount(tokensFor(role));
    expect(screen.getByText('signed-out')).toBeTruthy();
    expect(tokens.saved).toBeNull();
  });

  it('refreshes an expired access token before deciding', async () => {
    const fresh = tokensFor('CAREGIVER', { expiresInSeconds: 900 });
    const { fetch, tokens } = await mount(tokensFor('CAREGIVER', { expiresInSeconds: -60 }), (url) =>
      url.endsWith('/auth/refresh') ? json(200, fresh) : json(200, {}),
    );
    expect(fetch).toHaveBeenCalledWith('https://api.test/auth/refresh', expect.anything());
    expect(tokens.saved).toEqual(fresh);
    expect(screen.getByText('user:CAREGIVER')).toBeTruthy();
  });

  it('stays signed in when there is no signal at launch', async () => {
    const saved = tokensFor('CAREGIVER', { expiresInSeconds: -60 });
    const { tokens } = await mount(saved, () => {
      throw new TypeError('Network request failed');
    });
    expect(screen.getByText('user:CAREGIVER')).toBeTruthy();
    expect(tokens.saved).toEqual(saved);
  });

  it('is signed out when the API ends the session', async () => {
    const { expire } = await mount(tokensFor('CAREGIVER'));
    await expire();
    expect(screen.getByText('signed-out')).toBeTruthy();
  });

  it('signs in with tokens from a sign-in endpoint, and refuses an employer account', async () => {
    const { auth, tokens } = await mount(null);
    await act(async () => void (await auth().signIn(tokensFor('EMPLOYER'))));
    expect(screen.getByText('signed-out')).toBeTruthy();
    expect(tokens.saved).toBeNull();

    const caregiver = tokensFor('CAREGIVER', { caregiverId: 'cg-1' });
    let result: unknown;
    await act(async () => void (result = await auth().signIn(caregiver)));
    expect(result).toMatchObject({ role: 'CAREGIVER', caregiverId: 'cg-1' });
    expect(tokens.saved).toEqual(caregiver);
    expect(screen.getByText('user:CAREGIVER')).toBeTruthy();
  });

  it('signs out on the server and on the phone, even with no signal', async () => {
    const { auth, fetch, tokens } = await mount(tokensFor('CAREGIVER'), () => {
      throw new TypeError('Network request failed');
    });
    await act(async () => auth().signOut());
    expect(fetch).toHaveBeenCalledWith('https://api.test/auth/logout', expect.objectContaining({ method: 'POST' }));
    expect(tokens.saved).toBeNull();
    expect(screen.getByText('signed-out')).toBeTruthy();
  });
});
