import { act, render } from '@testing-library/react';
import { AuthProvider, useAuth, postLoginPath, type AuthUser } from '@/lib/api/auth-context';

/**
 * The public app hosts two audiences: patients/guardians and caregivers. Office
 * staff are the third category and belong to the /staff app - a staff token
 * must not make someone look signed in here, where there is nothing for them
 * to do.
 */

/** Only the payload segment is read; the signature is never verified client-side. */
function tokenWith(payload: Record<string, unknown>) {
  return ['e30', btoa(JSON.stringify(payload)), 'sig'].join('.');
}

let auth: ReturnType<typeof useAuth> | null = null;

function Probe() {
  auth = useAuth();
  return null;
}

function decoded(payload: Record<string, unknown>) {
  render(
    <AuthProvider>
      <Probe />
    </AuthProvider>,
  );
  let user: AuthUser | null = null;
  act(() => {
    user = auth!.applyTokens({ accessToken: tokenWith(payload), refreshToken: 'r' });
  });
  return user;
}

beforeEach(() => {
  window.localStorage.clear();
  auth = null;
});

describe('public-site auth context', () => {
  it('accepts a caregiver token, so caregiver sign-in works on this app', () => {
    const user = decoded({ sub: 'u1', email: 'c@example.com', role: 'CAREGIVER', caregiverId: 'cg-1' });

    expect(user).toMatchObject({ userId: 'u1', role: 'CAREGIVER', caregiverId: 'cg-1' });
  });

  it('still accepts a patient token', () => {
    expect(decoded({ sub: 'u2', email: 'p@example.com', role: 'PATIENT_GUARDIAN' })).toMatchObject({
      userId: 'u2',
      role: 'PATIENT_GUARDIAN',
    });
  });

  it.each(['ADMIN', 'STAFF', 'VERIFIER'])('rejects a %s token - that role belongs to /staff', (role) => {
    expect(decoded({ sub: 'u3', role })).toBeNull();
  });

  it('rejects a token with no role at all', () => {
    expect(decoded({ sub: 'u4' })).toBeNull();
  });

  it('rejects a malformed token rather than throwing', () => {
    render(
      <AuthProvider>
        <Probe />
      </AuthProvider>,
    );
    let user: AuthUser | null = { userId: 'seed', email: null, role: 'CAREGIVER' };
    act(() => {
      user = auth!.applyTokens({ accessToken: 'not-a-jwt', refreshToken: 'r' });
    });
    expect(user).toBeNull();
  });
});

describe('a token for a role this site does not serve', () => {
  const PUBLIC_KEY = 'care-platform-patient-tokens';

  it.each(['ADMIN', 'STAFF', 'VERIFIER'])('is never written to storage (%s)', (role) => {
    decoded({ sub: 'u3', role });

    // Not under the public site's key, and not under the staff app's either.
    expect(window.localStorage.getItem(PUBLIC_KEY)).toBeNull();
    expect(window.localStorage.length).toBe(0);
  });

  it('leaves an existing caregiver session alone rather than signing it out', () => {
    render(<AuthProvider><Probe /></AuthProvider>);
    act(() => {
      auth!.applyTokens({ accessToken: tokenWith({ sub: 'c1', role: 'CAREGIVER', caregiverId: 'cg-1' }), refreshToken: 'keep' });
    });
    act(() => {
      expect(auth!.applyTokens({ accessToken: tokenWith({ sub: 's1', role: 'STAFF' }), refreshToken: 'staff' })).toBeNull();
    });

    expect(auth!.user).toMatchObject({ userId: 'c1', role: 'CAREGIVER' });
    expect(JSON.parse(window.localStorage.getItem(PUBLIC_KEY)!).refreshToken).toBe('keep');
  });

  it('still stores a caregiver token', () => {
    decoded({ sub: 'u1', role: 'CAREGIVER', caregiverId: 'cg-1' });
    expect(JSON.parse(window.localStorage.getItem(PUBLIC_KEY)!).refreshToken).toBe('r');
  });
});

describe('postLoginPath', () => {
  it('sends caregivers to their profile and everyone else home', () => {
    expect(postLoginPath({ userId: 'a', email: null, role: 'CAREGIVER' })).toBe('/caregiver/dashboard');
    expect(postLoginPath({ userId: 'b', email: null, role: 'PATIENT_GUARDIAN' })).toBe('/');
  });
});
