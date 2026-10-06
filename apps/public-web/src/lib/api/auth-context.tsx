'use client';

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { api, clearTokens, getStoredTokens, storeTokens, type Tokens } from './client';

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

interface AuthContextValue {
  user: AuthUser | null;
  loading: boolean;
  login: (email: string, password: string) => Promise<void>;
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

  const applyTokens = useCallback((tokens: Tokens) => {
    storeTokens(tokens);
    const decoded = decodeJwt(tokens.accessToken);
    setUser(decoded);
    return decoded;
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const tokens = await api.post<Tokens>('/auth/login', { email, password });
      applyTokens(tokens);
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
