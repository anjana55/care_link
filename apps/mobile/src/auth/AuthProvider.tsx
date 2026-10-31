import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { decodePublicAuthUser, isTokenExpired, type AuthUser, type PublicRole, type Tokens } from '@care-platform/shared';
import { api as defaultApi, onSessionExpired as defaultOnSessionExpired, tokenStore as defaultTokenStore } from '@/api';
import type { ApiClient } from '@/api/client';
import type { TokenStore } from '@/api/token-store';

/**
 * Who is signed in on this phone.
 *
 * The app is for caregivers and clients. The shared decoder already refuses
 * every staff role; employers are refused here too - their area is on the
 * website. A refused session is cleared rather than kept half-signed-in.
 */
export const APP_ROLES: readonly PublicRole[] = ['CAREGIVER', 'PATIENT_GUARDIAN'];

export function appUserFrom(tokens: Tokens | null): AuthUser | null {
  if (!tokens) return null;
  const user = decodePublicAuthUser(tokens.accessToken);
  return user && APP_ROLES.includes(user.role) ? user : null;
}

interface AuthContextValue {
  user: AuthUser | null;
  /** False until the saved session has been read (and refreshed if needed). */
  ready: boolean;
  /** Starts a session from tokens a sign-in endpoint returned. Null when the account can't use the app. */
  signIn(tokens: Tokens): Promise<AuthUser | null>;
  signOut(): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

interface AuthProviderProps {
  children: ReactNode;
  /** For tests. */
  api?: ApiClient;
  tokens?: TokenStore;
  subscribeExpired?: (listener: () => void) => () => void;
}

export function AuthProvider({
  children,
  api = defaultApi,
  tokens = defaultTokenStore,
  subscribeExpired = defaultOnSessionExpired,
}: AuthProviderProps) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    let current = true;
    (async () => {
      let saved = await tokens.load();
      // An expired access token is normal after a night away: refresh before deciding.
      if (saved && isTokenExpired(saved.accessToken)) saved = (await api.refreshSession()) ?? tokens.get();
      const restored = appUserFrom(saved);
      if (saved && !restored) await tokens.clear();
      if (current) {
        setUser(restored);
        setReady(true);
      }
    })();
    const unsubscribe = subscribeExpired(() => setUser(null));
    return () => {
      current = false;
      unsubscribe();
    };
  }, [api, tokens, subscribeExpired]);

  const signIn = useCallback(
    async (next: Tokens) => {
      const signedIn = appUserFrom(next);
      if (!signedIn) {
        await tokens.clear();
        setUser(null);
        return null;
      }
      await tokens.set(next);
      setUser(signedIn);
      return signedIn;
    },
    [tokens],
  );

  const signOut = useCallback(async () => {
    // Revoke on the server first (best effort - offline must not trap anyone signed in).
    if (tokens.get()) await api.post('/auth/logout').catch(() => undefined);
    await tokens.clear();
    setUser(null);
  }, [api, tokens]);

  const value = useMemo(() => ({ user, ready, signIn, signOut }), [user, ready, signIn, signOut]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
