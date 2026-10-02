import type { Metadata, Viewport } from 'next';
import './globals.css';
import { I18nProvider } from '@/lib/i18n';
import { QueryProvider } from '@/lib/query-provider';
import { AuthProvider } from '@/lib/api/auth-context';

export const metadata: Metadata = {
  // The landing page ("/") and /find both declare their own titles; this is the
  // fallback for any page that does not.
  title: {
    default: 'CareLink — Find trusted caregivers',
    template: '%s · CareLink',
  },
  description:
    'CareLink connects families with verified caregivers and gives care teams one place to manage them.',
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  // Matches the `paper` token, so the browser chrome blends into the page
  // instead of drawing a hard white band above a pale background.
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
