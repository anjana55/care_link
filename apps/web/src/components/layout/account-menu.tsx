'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronDown, KeyRound, LogOut } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { ChangePasswordModal } from '@/components/users/change-password-modal';
import { cn } from '@/lib/utils';

const ITEM = 'flex w-full items-center gap-3 rounded px-3 py-2 text-left text-sm text-ink/80 hover:bg-paper hover:text-ink';

/**
 * Who is signed in, and what they can do about it: change their password, log
 * out. One labelled menu instead of two bare icons - a key and a door - that
 * people had to hover to tell apart.
 */
export function AccountMenu() {
  const { t } = useTranslation();
  const { user, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [changingPassword, setChangingPassword] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  // Open only: a click anywhere else, or Esc, closes it; Esc hands focus back to the button.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (!wrap.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      setOpen(false);
      trigger.current?.focus();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!user) return null;
  const name = user.email ?? user.phone ?? '';
  const role = t(`users.role.${user.role}`);

  return (
    <div ref={wrap} className="relative border-l border-border pl-4">
      <button
        ref={trigger}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={t('nav.account')}
        className="flex items-center gap-2.5 rounded-lg py-1 pl-1 pr-2 hover:bg-paper"
      >
        <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-brand-light text-sm font-semibold uppercase text-brand-dark">
          {name.replace(/^\+/, '').charAt(0) || '?'}
        </span>
        {/* Name and role only where there is room: on a phone the circle is the button. */}
        <span className="hidden max-w-[14rem] text-left sm:block">
          <span className="block truncate text-sm font-medium text-ink">{name}</span>
          <span className="block text-xs text-ink/55">{role}</span>
        </span>
        <ChevronDown size={15} aria-hidden className={cn('text-ink/45 transition-transform', open && 'rotate-180')} />
      </button>

      {open && (
        <div role="menu" aria-label={t('nav.account')} className="absolute right-0 top-full z-40 mt-2 w-64 rounded-lg border border-border bg-white p-1.5 shadow-xl">
          <div className="border-b border-border px-3 pb-2.5 pt-1.5">
            <div className="truncate text-sm font-medium text-ink">{name}</div>
            <div className="text-xs text-ink/55">{role}</div>
          </div>
          <div className="pt-1.5">
            {/* WhatsApp-only accounts have no password to change. */}
            {user.email && (
              <button
                type="button"
                role="menuitem"
                className={ITEM}
                onClick={() => {
                  setOpen(false);
                  setChangingPassword(true);
                }}
              >
                <KeyRound size={16} aria-hidden className="text-ink/50" />
                {t('changePassword.title')}
              </button>
            )}
            <button type="button" role="menuitem" className={ITEM} onClick={logout}>
              <LogOut size={16} aria-hidden className="text-ink/50" />
              {t('nav.logout')}
            </button>
          </div>
        </div>
      )}
      {changingPassword && <ChangePasswordModal onClose={() => setChangingPassword(false)} />}
    </div>
  );
}
