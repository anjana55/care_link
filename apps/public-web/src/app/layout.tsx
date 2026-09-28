import type { Metadata } from 'next';
import './globals.css';
import { I18nProvider } from '@/lib/i18n';
import { QueryProvider } from '@/lib/query-provider';
import { AuthProvider } from '@/lib/api/auth-context';

export const metadata: Metadata = {
  title: 'CareLink Finder — Find the right caregiver',
  description: 'Search verified caregivers by skill, location, language and availability.',
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
