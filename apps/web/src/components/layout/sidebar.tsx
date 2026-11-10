'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { X, LayoutDashboard, Users, HeartHandshake, Inbox, CalendarDays, Settings, ReceiptText, Wallet, Globe2, GraduationCap, Star, Megaphone, type LucideIcon } from 'lucide-react';
import { useCareRequestSummary } from '@/lib/hooks/use-care-requests';
import { useInternationalSummary } from '@/lib/hooks/use-international';
import { useAccountDeletionSummary } from '@/lib/hooks/use-account-deletions';
import { useReviewCounts } from '@/lib/hooks/use-reviews';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { cn } from '@/lib/utils';
import { BrandMark } from '@/components/layout/brand-mark';

interface NavItem {
  href: string;
  key: string;
  icon: LucideIcon;
  /** Pages that have no menu item of their own and are reached from this one: it stays lit on them. */
  also?: readonly string[];
  /** What is waiting on staff here, and how a screen reader says it. */
  badge?: number;
  badgeLabel?: string;
}

interface NavGroup {
  /** Heading above the group; none for the items that stand alone. */
  key?: string;
  items: NavItem[];
}

const DASHBOARD: NavItem = { href: '/dashboard', key: 'nav.dashboard', icon: LayoutDashboard };
const CAREGIVERS: NavItem = { href: '/caregivers', key: 'nav.caregivers', icon: Users };
// Every role has a Settings area: admins see all of it (staff users included),
// staff and verifiers the reference data. See lib/settings-sections.
const SETTINGS: NavItem = { href: '/settings', key: 'nav.settings', icon: Settings };

/**
 * The menu, in groups, so it reads as a few topics rather than one long list.
 *
 * Three pages have no item of their own and open from the page they belong to:
 * care plan templates from Bookings, account deletions from Clients, and staff
 * users from Settings. The assistant has its floating button on every page.
 *
 * Everything but Dashboard, Caregivers and Settings is ADMIN + STAFF only, as
 * the API has it; a VERIFIER gets those three with no headings.
 */
function useNavGroups(): NavGroup[] {
  const { user } = useAuth();
  const { t } = useTranslation();
  const office = user?.role === 'ADMIN' || user?.role === 'STAFF';
  const { data: summary } = useCareRequestSummary(office);
  const { data: overseas } = useInternationalSummary(office);
  const { data: deletions } = useAccountDeletionSummary(office);
  const { data: reviewCounts } = useReviewCounts(office);

  if (!office) return [{ items: [DASHBOARD, CAREGIVERS, SETTINGS] }];

  const requestsNew = summary?.new ?? 0;
  const deletionsWaiting = deletions?.pending ?? 0;
  // Written reviews waiting for approval - the part of Reviews staff must act on.
  const reviewsWaiting = reviewCounts?.pending ?? 0;
  const overseasWaiting = overseas ? overseas.new + overseas.pendingProfiles + overseas.pendingEmployers + overseas.interviewRequests : 0;

  return [
    { items: [DASHBOARD] },
    {
      key: 'nav.groups.care',
      items: [
        // Requests lead: they are the day's worklist.
        { href: '/requests', key: 'nav.requests', icon: Inbox, badge: requestsNew, badgeLabel: t('requests.newCount', { count: requestsNew }) },
        { href: '/bookings', key: 'nav.bookings', icon: CalendarDays, also: ['/care-plans'] },
      ],
    },
    {
      key: 'nav.groups.people',
      items: [
        CAREGIVERS,
        {
          href: '/clients',
          key: 'nav.clients',
          icon: HeartHandshake,
          also: ['/account-deletions'],
          badge: deletionsWaiting,
          badgeLabel: t('accountDeletions.waitingCount', { count: deletionsWaiting }),
        },
        { href: '/reviews', key: 'nav.reviews', icon: Star, badge: reviewsWaiting, badgeLabel: t('reviews.waitingCount', { count: reviewsWaiting }) },
      ],
    },
    {
      key: 'nav.groups.money',
      items: [
        { href: '/invoices', key: 'nav.invoices', icon: ReceiptText },
        { href: '/payouts', key: 'nav.payouts', icon: Wallet },
      ],
    },
    {
      key: 'nav.groups.overseas',
      items: [
        {
          href: '/international',
          key: 'nav.recruitment',
          icon: Globe2,
          badge: overseasWaiting,
          badgeLabel: t('international.waitingCount', { count: overseasWaiting }),
        },
        { href: '/training', key: 'nav.training', icon: GraduationCap },
      ],
    },
    {
      key: 'nav.groups.office',
      items: [{ href: '/announcements', key: 'nav.announcements', icon: Megaphone }, SETTINGS],
    },
  ];
}

function NavList({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  const { t } = useTranslation();
  const groups = useNavGroups();

  return (
    <nav className="flex-1 space-y-3 overflow-y-auto p-3">
      {groups.map((group, i) => (
        <div key={group.key ?? i} role={group.key ? 'group' : undefined} aria-label={group.key ? t(group.key) : undefined}>
          {group.key && (
            <p aria-hidden className="mb-1 px-3 text-xs font-semibold uppercase tracking-wide text-ink/45">
              {t(group.key)}
            </p>
          )}
          <div className="space-y-0.5">
            {group.items.map((item) => {
              const active = [item.href, ...(item.also ?? [])].some((href) => pathname?.startsWith(href));
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
                  <span className="flex-1">{t(item.key)}</span>
                  {item.badge !== undefined && item.badge > 0 && (
                    <span className="min-w-[1.25rem] rounded-full bg-accent px-1.5 text-center text-xs font-semibold tabular-nums text-white" aria-label={item.badgeLabel}>
                      {item.badge}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        </div>
      ))}
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
