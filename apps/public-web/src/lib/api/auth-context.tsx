'use client';

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { decodePublicAuthUser, isTokenExpired, type AuthUser, type PublicLoginPortal } from '@care-platform/shared';
import { api, ApiError, clearTokens, getStoredTokens, refreshSession, SESSION_EXPIRED_EVENT, storeTokens, type Tokens } from './client';

/**
 * The signed-in person (packages/shared/src/types/auth.ts). Caregivers are a
 * separate category from office staff, but both have a legitimate presence on
 * the public site: patients search and book, and caregivers register and then
 * manage their own profile, documents and shifts. Office-staff roles are
 * deliberately absent - they belong to the /staff app.
 */
export type { AuthUser };

/**
 * Where each role lands after signing in. Mirrors apps/web's postLoginPath,
 * but a caregiver's home is their own area in THIS app (/caregiver/dashboard), not /staff/me.
 */
export function postLoginPath(user: AuthUser): string {
  return user.role === 'CAREGIVER' ? '/caregiver/dashboard' : user.role === 'EMPLOYER' ? '/employer' : '/';
}

/** Whether an access token is past its expiry (with a little slack for clock drift). */
const isExpired = (token: string): boolean => isTokenExpired(token);

/**
 * The person an access token belongs to, or null for any role that has no
 * business on the public site - every staff role included. The allowlist is
 * shared with the mobile app so the two can't drift.
 */
const decodeJwt = (token: string): AuthUser | null => decodePublicAuthUser(token);

/**
 * What /auth/login says for a wrong email or password. The API now refuses an
 * account that belongs to another portal with this very message; this constant
 * is only the fallback for an older API that still hands back a session, so the
 * visitor sees the same words either way. Keep in step with AuthService.login.
 */
export const INVALID_CREDENTIALS_MESSAGE = 'Invalid credentials';

/** The sign-in screens on this site. The API refuses credentials that belong to another one. */
export type LoginPortal = PublicLoginPortal;

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string, portal: LoginPortal) => Promise<void>;
  /** Used by the verify-email page, which receives tokens directly rather than calling /auth/login. */
  applyTokens: (tokens: Tokens) => AuthUser | null;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    const tokens = getStoredTokens();
    if (!tokens) {
      setLoading(false);
    } else if (!isExpired(tokens.accessToken)) {
      setUser(decodeJwt(tokens.accessToken));
      setLoading(false);
    } else {
      // The access token lapsed while the visitor was away (15 minutes). Check
      // the session is still alive before showing them as signed in: a page
      // that says "signed in" and then fails every action with "Unauthorized"
      // is worse than one that offers sign-in straight away.
      void refreshSession().then((fresh) => {
        if (cancelled) return;
        const still = fresh ?? getStoredTokens();
        setUser(still ? decodeJwt(still.accessToken) : null);
        setLoading(false);
      });
    }

    // The session ended mid-visit (see SESSION_EXPIRED_EVENT), or another tab
    // signed in or out.
    const onExpired = () => setUser(null);
    const onStorage = (e: StorageEvent) => {
      if (e.key !== null && e.key !== 'care-platform-patient-tokens') return;
      const now = getStoredTokens();
      setUser(now ? decodeJwt(now.accessToken) : null);
    };
    window.addEventListener(SESSION_EXPIRED_EVENT, onExpired);
    window.addEventListener('storage', onStorage);
    return () => {
      cancelled = true;
      window.removeEventListener(SESSION_EXPIRED_EVENT, onExpired);
      window.removeEventListener('storage', onStorage);
    };
  }, []);

  /**
   * Starts a session from a token pair - but only for a role this site serves.
   *
   * The role is checked BEFORE anything is written. Storing first (as this used
   * to) left an office-staff access and refresh token in this site's
   * localStorage even though nobody was "signed in", where it would be sent with
   * every later API call from a site with far more third-party surface than the
   * staff app. A pair that is refused is simply dropped; it is not revoked
   * server-side, because the API's logout revokes every session of that user and
   * would sign the staff member out of the staff app as well.
   */
  const applyTokens = useCallback((tokens: Tokens) => {
    const decoded = decodeJwt(tokens.accessToken);
    if (!decoded) return null;
    storeTokens(tokens);
    setUser(decoded);
    return decoded;
  }, []);

  const login = useCallback(
    async (email: string, password: string, portal: LoginPortal) => {
      // The API holds the sign-in to the portal named here: a staff account, or
      // the other kind of customer account, is refused with "Invalid credentials"
      // before any session exists.
      const tokens = await api.post<Tokens>('/auth/login', { email, password, portal });
      // Belt and braces for an API that predates portal enforcement: correct
      // credentials for an account this site does not serve are still reported
      // exactly as a wrong password (see INVALID_CREDENTIALS_MESSAGE), and the
      // session is not kept.
      if (!applyTokens(tokens)) throw new ApiError(401, INVALID_CREDENTIALS_MESSAGE);
    },
    [applyTokens],
  );

  const logout = useCallback(() => {
    api.post('/auth/logout').catch(() => undefined);
    clearTokens();
    setUser(null);
  }, []);

  return <AuthContext.Provider value={{ user, loading, login, applyTokens, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
