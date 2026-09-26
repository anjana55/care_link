'use client';

import { LogOut } from 'lucide-react';
import { useTranslation, type Locale } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';

const LOCALES: { value: Locale; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'si', label: 'සිං' },
  { value: 'ta', label: 'தமி' },
];

export function Topbar() {
  const { locale, setLocale, t } = useTranslation();
  const { user, logout } = useAuth();

  return (
    <header className="flex h-16 items-center justify-between border-b border-border bg-white px-6">
      <div />
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
        {user && (
          <div className="flex items-center gap-3 border-l border-border pl-4">
            <div className="text-right">
              <div className="text-sm font-medium text-ink">{user.email}</div>
              <div className="text-xs text-ink/50">{user.role}</div>
            </div>
            <button
              onClick={logout}
              className="flex h-9 w-9 items-center justify-center rounded text-ink/60 hover:bg-paper hover:text-ink"
              title={t('nav.logout')}
            >
              <LogOut size={16} />
            </button>
          </div>
        )}
      </div>
    </header>
  );
}
