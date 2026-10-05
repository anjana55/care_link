'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X, LayoutDashboard, Users, HeartHandshake, Sparkles, Languages, MapPin, ScrollText, ShieldCheck, MessageCircle } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { cn } from '@/lib/utils';
import { BrandMark } from '@/components/layout/brand-mark';

const ITEMS = [
  { href: '/dashboard', key: 'nav.dashboard', icon: LayoutDashboard },
  { href: '/caregivers', key: 'nav.caregivers', icon: Users },
  { href: '/skills', key: 'nav.skills', icon: Sparkles },
  { href: '/languages', key: 'nav.languages', icon: Languages },
  { href: '/locations', key: 'nav.locations', icon: MapPin },
  { href: '/audit-log', key: 'nav.auditLog', icon: ScrollText },
];

// Clients = registered patients/guardians. Separate from both ITEMS and
// ADMIN_ITEMS because the API allows ADMIN + STAFF: in ITEMS it would leak to
// VERIFIER, in ADMIN_ITEMS it would hide from STAFF.
const CLIENT_ITEM = { href: '/clients', key: 'nav.clients', icon: HeartHandshake };

// Admin-only: rendered separately from ITEMS so they never show for STAFF/VERIFIER.
const ADMIN_ITEMS = [
  { href: '/users', key: 'nav.users', icon: ShieldCheck },
  { href: '/settings/whatsapp', key: 'nav.whatsappSettings', icon: MessageCircle },
];

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const { user } = useAuth();
  const canSeeClients = user?.role === 'ADMIN' || user?.role === 'STAFF';
  // Clients sit straight after Caregivers, the list they mirror.
  const base = canSeeClients ? [ITEMS[0], ITEMS[1], CLIENT_ITEM, ...ITEMS.slice(2)] : ITEMS;
  const items = user?.role === 'ADMIN' ? [...base, ...ADMIN_ITEMS] : base;

  return (
    <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
      {items.map((item) => {
        const active = pathname?.startsWith(item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded px-3 py-2 text-sm font-medium transition-colors',
              active ? 'bg-brand-light text-brand-dark' : 'text-ink/70 hover:bg-paper hover:text-ink',
            )}
          >
            <Icon size={17} strokeWidth={2} />
            {t(item.key)}
          </Link>
        );
      })}
    </nav>
  );
}

function SidebarBody({ onNavigate, closeLabel }: { onNavigate?: () => void; closeLabel: string }) {
  return (
    <>
      <div className="flex h-16 shrink-0 items-center justify-between gap-2 border-b border-border px-5">
        {/* The staff app lives under the /staff basePath, so next/link here
            would produce /staff/ - a dead link. The brand goes to /dashboard,
            which basePath rewrites back to /staff/dashboard. */}
        <Link href="/dashboard" className="rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand">
          <BrandMark />
        </Link>
        {onNavigate && (
          <button
            onClick={onNavigate}
            className="flex h-8 w-8 items-center justify-center rounded text-ink/60 hover:bg-paper hover:text-ink md:hidden"
            aria-label={closeLabel}
          >
            <X size={18} />
          </button>
        )}
      </div>
      <NavList onNavigate={onNavigate} />
    </>
  );
}

/**
 * Desktop rail, plus - below md, where the rail is hidden - an off-canvas
 * drawer driven by the topbar's menu button. Without the drawer /staff was
 * unusable on a phone: no navigation at all, no way to change page.
 */
export function Sidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const closeLabel = t('nav.closeMenu');

  // Drawer is only ever open on small screens; if the viewport grows past the
  // md breakpoint the rail reappears and the overlay must not linger.
  useEffect(() => {
    if (!open) return;
    const mq = window.matchMedia('(min-width: 768px)');
    const close = () => {
      if (mq.matches) onClose();
    };
    mq.addEventListener('change', close);
    return () => mq.removeEventListener('change', close);
  }, [open, onClose]);

  return (
    <>
      <aside className="hidden w-60 shrink-0 border-r border-border bg-white md:flex md:flex-col">
        <SidebarBody closeLabel={closeLabel} />
      </aside>

      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            className="absolute inset-0 bg-ink/40"
            onClick={onClose}
            aria-label={closeLabel}
          />
          <aside className="absolute inset-y-0 left-0 flex w-64 flex-col border-r border-border bg-white shadow-xl">
            <SidebarBody onNavigate={onClose} closeLabel={closeLabel} />
          </aside>
        </div>
      )}
    </>
  );
}