'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { LayoutDashboard, Users, Sparkles, Languages, MapPin, ScrollText } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { cn } from '@/lib/utils';

const ITEMS = [
  { href: '/dashboard', key: 'nav.dashboard', icon: LayoutDashboard },
  { href: '/caregivers', key: 'nav.caregivers', icon: Users },
  { href: '/skills', key: 'nav.skills', icon: Sparkles },
  { href: '/languages', key: 'nav.languages', icon: Languages },
  { href: '/locations', key: 'nav.locations', icon: MapPin },
  { href: '/audit-log', key: 'nav.auditLog', icon: ScrollText },
];

export function Sidebar() {
  const pathname = usePathname();
  const { t } = useTranslation();

  return (
    <aside className="hidden w-60 shrink-0 border-r border-border bg-white md:flex md:flex-col">
      <div className="flex h-16 items-center gap-2 border-b border-border px-5">
        <div className="flex h-8 w-8 items-center justify-center rounded bg-brand text-sm font-bold text-white">CP</div>
        <span className="text-sm font-semibold text-ink">Care Platform</span>
      </div>
      <nav className="flex-1 space-y-0.5 p-3">
        {ITEMS.map((item) => {
          const active = pathname?.startsWith(item.href);
          const Icon = item.icon;
          return (
            <Link
              key={item.href}
              href={item.href}
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
    </aside>
  );
}
