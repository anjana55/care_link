'use client';

import { createContext, useContext, useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  DEFAULT_BRANDING,
  brandingLogoUrl,
  derivePalette,
  normalizeBranding,
  paletteCssVars,
  type PublicBranding,
} from '@care-platform/shared';
import { API_URL } from '@/lib/api/client';
import { I18nProvider } from '@/lib/i18n/provider';

/**
 * The white-label branding (Settings > Branding) for client components: the
 * company name, short name, logo and languages, plus the theme colours applied
 * to the page.
 *
 * The root layout renders with a server-fetched copy (`initial`), so the first
 * paint is already in the right colours; this then keeps it current from the
 * API, which is how a change saved in Settings shows up without a reload.
 */
export const BRANDING_QUERY_KEY = ['branding'] as const;

const BrandingContext = createContext<PublicBranding | null>(null);

async function fetchBranding(): Promise<PublicBranding> {
  const res = await fetch(`${API_URL}/branding`, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`Branding request failed (${res.status})`);
  return normalizeBranding(await res.json());
}

export function BrandingProvider({ initial, children }: { initial: PublicBranding; children: ReactNode }) {
  const { data } = useQuery({
    queryKey: BRANDING_QUERY_KEY,
    queryFn: fetchBranding,
    initialData: initial,
    // The server copy can be up to 30s old; check once on load.
    initialDataUpdatedAt: 0,
    staleTime: 60_000,
  });
  const branding = data ?? initial;

  // Inline custom properties outrank the server-rendered :root rule, so a
  // newer palette from the API repaints the page in place.
  useEffect(() => {
    const vars = paletteCssVars(derivePalette(branding.primaryColor, branding.accentColor));
    const root = document.documentElement.style;
    for (const [name, value] of Object.entries(vars)) root.setProperty(name, value);
  }, [branding.primaryColor, branding.accentColor]);

  return (
    <BrandingContext.Provider value={branding}>
      <I18nProvider defaultLocale={branding.defaultLocale} enabledLocales={branding.enabledLocales} vars={{ brand: branding.companyName }}>
        {children}
      </I18nProvider>
    </BrandingContext.Provider>
  );
}

/** Outside a BrandingProvider (isolated component tests) this is the shipped identity. */
export function useBranding(): PublicBranding & { logoUrl: string | null } {
  const ctx = useContext(BrandingContext) ?? DEFAULT_BRANDING;
  return { ...ctx, logoUrl: brandingLogoUrl(API_URL, ctx) };
}
