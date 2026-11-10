'use client';

import { ArrowLeft, Menu } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { LanguageToggle } from '@/components/layout/language-toggle';
import { AccountMenu } from '@/components/layout/account-menu';
import { PublicSiteLink } from '@/components/layout/brand-mark';
import { QuickSearch } from '@/components/layout/quick-search';

export function Topbar({ onMenu }: { onMenu: () => void }) {
  const { t } = useTranslation();

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
        <QuickSearch />
        <LanguageToggle />
        <AccountMenu />
      </div>
    </header>
  );
}