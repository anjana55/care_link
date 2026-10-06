'use client';

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { api, ApiError, clearTokens, getStoredTokens, storeTokens, type Tokens } from './client';

export interface AuthUser {
  userId: string;
  /** Null for customers who signed up with WhatsApp instead of an email address. */
  email: string | null;
  phone?: string;
  /**
   * Caregivers are a separate category from office staff, but both have a
   * legitimate presence on the public site: patients search and book, and
   * caregivers register and then manage their own profile, documents and shifts. Office-staff
   * roles are deliberately absent - they belong to the /staff app.
   */
  role: 'PATIENT_GUARDIAN' | 'CAREGIVER';
  patientId?: string;
  caregiverId?: string;
}

/**
 * Where each role lands after signing in. Mirrors apps/web's postLoginPath,
 * but a caregiver's home is their own area in THIS app (/caregiver/dashboard), not /staff/me.
 */
export function postLoginPath(user: AuthUser): string {
  return user.role === 'CAREGIVER' ? '/caregiver/dashboard' : '/';
}

function decodeJwt(token: string): AuthUser | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    // An allowlist, not a deleted check. Widening it to "accept anything but
    // patients" would let an ADMIN/STAFF/VERIFIER token sign someone in on the
    // public site, where there is nothing for them to see.
    if (payload.role !== 'PATIENT_GUARDIAN' && payload.role !== 'CAREGIVER') return null;
    return {
      userId: payload.sub,
      email: payload.email ?? null,
      phone: payload.phone,
      role: payload.role,
      patientId: payload.patientId,
      caregiverId: payload.caregiverId,
    };
  } catch {
    return null;
  }
}

/**
 * What /auth/login says for a wrong email or password. The API now refuses an
 * account that belongs to another portal with this very message; this constant
 * is only the fallback for an older API that still hands back a session, so the
 * visitor sees the same words either way. Keep in step with AuthService.login.
 */
export const INVALID_CREDENTIALS_MESSAGE = 'Invalid credentials';

/** The two sign-in screens on this site. The API refuses credentials that belong to the other one. */
export type LoginPortal = 'caregiver' | 'customer';

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
    const tokens = getStoredTokens();
    if (tokens) setUser(decodeJwt(tokens.accessToken));
    setLoading(false);
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
