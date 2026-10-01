'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';

export default function ProtectedLayout({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const { fontClass } = useTranslation();
  const router = useRouter();

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
      <Sidebar />
      <div className="flex min-h-screen flex-1 flex-col">
        <Topbar />
        <main className="flex-1 overflow-y-auto p-6">{children}</main>
      </div>
    </div>
  );
}
