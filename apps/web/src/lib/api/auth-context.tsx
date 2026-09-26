'use client';

import { createContext, useContext, useEffect, useState, ReactNode, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import { api, clearTokens, getStoredTokens, storeTokens, type Tokens } from './client';

export interface AuthUser {
  userId: string;
  email: string;
  role: 'ADMIN' | 'STAFF' | 'VERIFIER' | 'CAREGIVER';
  /** Present only when role === 'CAREGIVER': the caregiver record this login owns. */
  caregiverId?: string;
}

/** Where to land right after login/verification, based on role. */
export function postLoginPath(user: AuthUser): string {
  return user.role === 'CAREGIVER' ? '/me' : '/dashboard';
}

function decodeJwt(token: string): AuthUser | null {
  try {
    const payload = JSON.parse(atob(token.split('.')[1]));
    return { userId: payload.sub, email: payload.email, role: payload.role, caregiverId: payload.caregiverId };
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
  const router = useRouter();

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
      const decoded = applyTokens(tokens);
      router.push(decoded ? postLoginPath(decoded) : '/login');
    },
    [router, applyTokens],
  );

  const logout = useCallback(() => {
    api.post('/auth/logout').catch(() => undefined);
    clearTokens();
    setUser(null);
    router.push('/login');
  }, [router]);

  return <AuthContext.Provider value={{ user, loading, login, applyTokens, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
