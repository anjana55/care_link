'use client';

import { useState } from 'react';
import { ArrowLeft, KeyRound, LogOut, Menu } from 'lucide-react';
import { useTranslation, type Locale } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { ChangePasswordModal } from '@/components/users/change-password-modal';
import { PublicSiteLink } from '@/components/layout/brand-mark';

const LOCALES: { value: Locale; label: string }[] = [
  { value: 'en', label: 'EN' },
  { value: 'si', label: 'සිං' },
  { value: 'ta', label: 'தமி' },
];

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { locale, setLocale, t } = useTranslation();
  const { user, logout } = useAuth();
  const [changingPassword, setChangingPassword] = useState(false);

  return (
    // Sticky: it holds the language switch, the account menu and (below md) the
    // only navigation trigger, so it has to stay reachable while a long list
    // scrolls past.
    <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between gap-4 border-b border-border bg-white px-4 md:px-6">
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={onMenu}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded text-ink/60 hover:bg-paper hover:text-ink md:hidden"
          aria-label={t('nav.openMenu')}
        >
          <Menu size={18} />
        </button>
        <PublicSiteLink>
          <ArrowLeft size={15} />
          <span className="truncate">{t('nav.backToPublic')}</span>
        </PublicSiteLink>
      </div>
      <div className="flex shrink-0 items-center gap-4">
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
            {/* Name/role only: on a narrow screen the buttons matter more. */}
            <div className="hidden text-right sm:block">
              <div className="text-sm font-medium text-ink">{user.email ?? user.phone}</div>
              <div className="text-xs text-ink/50">{user.role}</div>
            </div>
            {/* WhatsApp-only accounts have no password to change. */}
            {user.email && (
              <button
                onClick={() => setChangingPassword(true)}
                className="flex h-9 w-9 items-center justify-center rounded text-ink/60 hover:bg-paper hover:text-ink"
                title={t('changePassword.title')}
              >
                <KeyRound size={16} />
              </button>
            )}
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
      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
    </header>
  );
}