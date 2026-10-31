import type { ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { createQueryClient } from '@/api/query-client';
import { BrandingProvider } from '@/branding/BrandingProvider';
import { I18nProvider } from '@/i18n';
import { AuthProvider } from '@/auth/AuthProvider';

/** The app's providers around a single screen, as the root layout arranges them. */
export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={createQueryClient()}>
      <BrandingProvider>
        <I18nProvider>
          <AuthProvider>{children}</AuthProvider>
        </I18nProvider>
      </BrandingProvider>
    </QueryClientProvider>
  );
}

type Handler = (body: Record<string, unknown>) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>;

/**
 * Answers API calls by path ("POST /auth/login"); anything else has no network.
 * Returns the calls made, with their parsed bodies, for assertions.
 */
export function serveApi(routes: Record<string, Handler>) {
  const calls: { route: string; body: Record<string, unknown>; headers: Record<string, string> }[] = [];
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const path = new URL(String(url)).pathname.replace(/^\/api/, '');
    const route = `${init.method ?? 'GET'} ${path}`;
    const body = init.body ? JSON.parse(String(init.body)) : {};
    calls.push({ route, body, headers: (init.headers ?? {}) as Record<string, string> });
    const handler = routes[route];
    if (!handler) throw new TypeError(`Network request failed (no route for ${route})`);
    const answer = await handler(body);
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as never;
  return calls;
}
