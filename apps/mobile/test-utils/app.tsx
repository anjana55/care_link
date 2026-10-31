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

type Handler = (body: Record<string, unknown>, query: Record<string, string>) => { status: number; body?: unknown } | Promise<{ status: number; body?: unknown }>;

/**
 * Answers API calls by path ("POST /auth/login"); anything else has no network.
 * Returns the calls made, with their parsed bodies (or an upload's parts), for assertions.
 */
export function serveApi(routes: Record<string, Handler>) {
  const calls: { route: string; body: Record<string, unknown>; headers: Record<string, string>; query: Record<string, string> }[] = [];
  globalThis.fetch = jest.fn(async (url: string, init: RequestInit = {}) => {
    const parsed = new URL(String(url));
    const path = parsed.pathname.replace(/^\/api/, '');
    const route = `${init.method ?? 'GET'} ${path}`;
    // An upload's parts by name (a file part is its { uri, name, type }); anything else is JSON.
    const form = init.body as unknown as { _parts?: [string, unknown][] } | undefined;
    const body = form?._parts ? Object.fromEntries(form._parts) : init.body ? JSON.parse(String(init.body)) : {};
    calls.push({ route, body, headers: (init.headers ?? {}) as Record<string, string>, query: Object.fromEntries(parsed.searchParams) });
    const handler = routes[route];
    if (!handler) throw new TypeError(`Network request failed (no route for ${route})`);
    const answer = await handler(body, Object.fromEntries(parsed.searchParams));
    return new Response(answer.body === undefined ? null : JSON.stringify(answer.body), {
      status: answer.status,
      headers: { 'content-type': 'application/json' },
    });
  }) as never;
  return calls;
}
