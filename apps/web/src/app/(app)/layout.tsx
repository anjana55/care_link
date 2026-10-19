'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { fontClass } = useTranslation();
  const router = useRouter();
  const [navOpen, setNavOpen] = useState(false);

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    // This is the staff operations app - a self-registered caregiver login
    // has no business here (every page under it is staff-role-gated), so
    // send them to their own self-service area instead of a wall of 403s.
    if (user.role === 'CAREGIVER') {
      router.replace('/me');
    }
  }, [loading, user, router]);

  if (loading || !user || user.role === 'CAREGIVER') {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-ink/50">
        <span>Loading…</span>
      </div>
    );
  }

  return (
    <div className={`flex min-h-screen ${fontClass}`}>
      {/* Printing (an invoice, a payout statement) prints the page's content only. */}
      <div className="flex print:hidden">
        <Sidebar open={navOpen} onClose={() => setNavOpen(false)} />
      </div>
      <div className="flex min-h-screen min-w-0 flex-1 flex-col">
        <div className="print:hidden">
          <Topbar onMenu={() => setNavOpen(true)} />
        </div>
        <main className="flex-1 overflow-y-auto p-6 print:overflow-visible print:p-0">{children}</main>
      </div>
    </div>
  );
}
