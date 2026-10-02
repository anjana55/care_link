import type { Metadata, Viewport } from 'next';
import './globals.css';
import { I18nProvider } from '@/lib/i18n/provider';
import { QueryProvider } from '@/lib/api/query-provider';
import { AuthProvider } from '@/lib/api/auth-context';

export const metadata: Metadata = {
  // The staff area is reached at /staff; the default title is what a
  // bookmarked tab shows and was still the old "Care Platform" name.
  title: {
    default: 'CareLink staff',
    template: '%s · CareLink staff',
  },
  description: 'CareLink staff area - caregiver registration, management and verification',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Matches the `paper` token, so the browser chrome blends into the page.
  themeColor: '#F6F8F2',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-screen bg-paper text-ink antialiased">
        <QueryProvider>
          <I18nProvider>
            <AuthProvider>{children}</AuthProvider>
          </I18nProvider>
        </QueryProvider>
      </body>
    </html>
  );
}
