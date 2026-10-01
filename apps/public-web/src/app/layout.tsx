import type { Metadata } from 'next';
import './globals.css';
import { I18nProvider } from '@/lib/i18n';
import { QueryProvider } from '@/lib/query-provider';
import { AuthProvider } from '@/lib/api/auth-context';

export const metadata: Metadata = {
  title: 'CareLink — Find trusted caregivers. Manage care with confidence.',
  description:
    'CareLink connects families in Sri Lanka with verified caregivers, and gives caregivers, staff and admins one place to manage it all.',
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
