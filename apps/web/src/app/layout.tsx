import type { Metadata, Viewport } from 'next';
import './globals.css';
import { brandingAssetUrl, brandingLogoUrl, defaultFaviconDataUrl, derivePalette, paletteCss } from '@care-platform/shared';
import { QueryProvider } from '@/lib/api/query-provider';
import { AuthProvider } from '@/lib/api/auth-context';
import { BrandingProvider } from '@/lib/branding/provider';
import { getBranding } from '@/lib/branding/server';

// Same as the client's API_URL: the browser loads the logo, so it must be the public address.
const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

export async function generateMetadata(): Promise<Metadata> {
  const b = await getBranding();
  // The browser tab: the square symbol when there is one, else the logo, else the shipped mark in the brand colour.
  const icon = brandingAssetUrl(PUBLIC_API_URL, b, 'symbol', { png: 64 }) ?? brandingLogoUrl(PUBLIC_API_URL, b) ?? defaultFaviconDataUrl(b.primaryColor);
  return {
    // The staff area is reached at /staff; the default title is what a bookmarked tab shows.
    title: {
      default: `${b.companyName} staff`,
      template: `%s · ${b.companyName} staff`,
    },
    description: `${b.companyName} staff area - caregiver registration, management and verification`,
    icons: { icon },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const b = await getBranding();
  return {
    width: 'device-width',
    initialScale: 1,
    // Matches the `paper` token, so the browser chrome blends into the page.
    themeColor: derivePalette(b.primaryColor, b.accentColor).paper,
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const branding = await getBranding();
  return (
    <html lang={branding.defaultLocale}>
      <head>
        {/* The white-label palette (Settings > Branding), in place before the first paint. */}
        <style id="brand-theme" dangerouslySetInnerHTML={{ __html: paletteCss(derivePalette(branding.primaryColor, branding.accentColor)) }} />
      </head>
      <body className="min-h-screen bg-paper text-ink antialiased">
        <QueryProvider>
          <BrandingProvider initial={branding}>
            <AuthProvider>{children}</AuthProvider>
          </BrandingProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
