import type { Metadata, Viewport } from 'next';
import './globals.css';
import { brandingLogoUrl, defaultFaviconDataUrl, derivePalette, paletteCss } from '@care-platform/shared';
import { QueryProvider } from '@/lib/query-provider';
import { AuthProvider } from '@/lib/api/auth-context';
import { DeviceShortlistSync } from '@/components/care/device-shortlist-sync';
import { BrandingProvider } from '@/lib/branding/provider';
import { getBranding } from '@/lib/branding/server';
import { AdsProvider } from '@/components/ads/adsense';
import { getAdsConfig } from '@/lib/ads/server';

// Same as the client's API_URL: the browser loads the logo, so it must be the public address.
const PUBLIC_API_URL = process.env.NEXT_PUBLIC_API_URL ?? '/api';

export async function generateMetadata(): Promise<Metadata> {
  const b = await getBranding();
  const icon = brandingLogoUrl(PUBLIC_API_URL, b) ?? defaultFaviconDataUrl(b.primaryColor);
  return {
    // The landing page ("/") and /find both declare their own titles; this is the
    // fallback for any page that does not.
    title: {
      default: `${b.companyName} — ${b.tagline ?? 'Find trusted caregivers'}`,
      template: `%s · ${b.companyName}`,
    },
    description: `${b.companyName} connects families with verified caregivers and gives care teams one place to manage them.`,
    icons: { icon },
  };
}

export async function generateViewport(): Promise<Viewport> {
  const b = await getBranding();
  return {
    width: 'device-width',
    initialScale: 1,
    // Matches the `paper` token, so the browser chrome blends into the page
    // instead of drawing a hard white band above a pale background.
    themeColor: derivePalette(b.primaryColor, b.accentColor).paper,
  };
}

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const [branding, ads] = await Promise.all([getBranding(), getAdsConfig()]);
  return (
    <html lang={branding.defaultLocale}>
      <head>
        {/* The white-label palette (Settings > Branding), in place before the first paint. */}
        <style id="brand-theme" dangerouslySetInnerHTML={{ __html: paletteCss(derivePalette(branding.primaryColor, branding.accentColor)) }} />
      </head>
      <body className="min-h-screen bg-paper text-ink antialiased">
        <QueryProvider>
          <BrandingProvider initial={branding}>
            <AuthProvider>
              <DeviceShortlistSync />
              {/* Google AdSense (Settings > Ads) - public marketing and search pages only. */}
              <AdsProvider config={ads}>{children}</AdsProvider>
            </AuthProvider>
          </BrandingProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
