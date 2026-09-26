'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { LogOut } from 'lucide-react';
import { useAuth, postLoginPath } from '@/lib/api/auth-context';
import { useTranslation, type Locale } from '@/lib/i18n/provider';

const LOCALES: { value: Locale; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'si', label: 'සිං' },
  { value: 'ta', label: 'தமி' },
];

export default function CaregiverLayout({ children }: { children: React.ReactNode }) {
  const { user, loading, logout } = useAuth();
  const { locale, setLocale, fontClass, t } = useTranslation();
  const router = useRouter();

  useEffect(() => {
    if (loading) return;
    if (!user) {
      router.replace('/login');
      return;
    }
    // This shell is for self-service caregivers only - staff accounts get
    // bounced to their own app rather than seeing an empty/broken page here.
    if (user.role !== 'CAREGIVER') {
      router.replace(postLoginPath(user));
    }
  }, [loading, user, router]);

  if (loading || !user || user.role !== 'CAREGIVER') {
    return (
      <div className="flex min-h-screen items-center justify-center text-sm text-ink/50">
        <span>Loading…</span>
      </div>
    );
  }

  return (
    <div className={`min-h-screen bg-paper ${fontClass}`}>
      <header className="flex h-16 items-center justify-between border-b border-border bg-white px-6">
        <div className="flex items-center gap-2">
          <div className="flex h-8 w-8 items-center justify-center rounded bg-brand text-sm font-bold text-white">CP</div>
          <span className="text-sm font-semibold text-ink">Care Platform</span>
        </div>
        <div className="flex items-center gap-4">
          <div className="flex overflow-hidden rounded border border-border">
            {LOCALES.map((l) => (
              <button
                key={l.value}
                onClick={() => setLocale(l.value)}
                className={`px-2.5 py-1.5 text-xs font-medium transition-colors ${
                  locale === l.value ? 'bg-brand text-white' : 'bg-white text-ink/60 hover:bg-paper'
                }`}
                aria-pressed={locale === l.value}
              >
                {l.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3 border-l border-border pl-4">
            <span className="text-sm text-ink/70">{user.email}</span>
            <button
              onClick={logout}
              className="flex h-9 w-9 items-center justify-center rounded text-ink/60 hover:bg-paper hover:text-ink"
              title={t('nav.logout')}
            >
              <LogOut size={16} />
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-3xl p-6">{children}</main>
    </div>
  );
}
