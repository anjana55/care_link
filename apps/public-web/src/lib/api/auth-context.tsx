'use client';

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { api, clearTokens, getStoredTokens, storeTokens, type Tokens } from './client';

export interface AuthUser {
  userId: string;
  /** Null for customers who signed up with WhatsApp instead of an email address. */
  email: string | null;
  phone?: string;
  role: 'PATIENT_GUARDIAN';
  patientId?: string;
}

function decodeJwt(token: string): AuthUser | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    if (payload.role !== 'PATIENT_GUARDIAN') return null;
    return { userId: payload.sub, email: payload.email ?? null, phone: payload.phone, role: payload.role, patientId: payload.patientId };
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
