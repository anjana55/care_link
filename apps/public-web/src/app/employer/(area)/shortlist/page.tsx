'use client';

import Link from 'next/link';
import { X } from 'lucide-react';
import { useTranslation } from '@/lib/i18n';
import { useShortlist } from '@/lib/hooks/use-international';
import { TalentCard } from '@/components/international/talent-card';

/** Shared profiles the employer saved. A caregiver who stops sharing drops out of the list. */
export default function EmployerShortlistPage() {
  const { t, locale } = useTranslation();
  const { data = [], isLoading, toggle } = useShortlist(locale);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-bold text-ink">{t('employer.shortlist.title')}</h1>
        <p className="mt-1 text-sm text-ink/60">{t('employer.shortlist.intro')}</p>
      </div>
      {isLoading && <div className="h-40 animate-pulse rounded-lg bg-white" aria-hidden />}
      {!isLoading && data.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-white p-8 text-center text-sm text-ink/60">
          {t('employer.shortlist.empty')}{' '}
          <Link href="/international#talent" className="font-semibold text-brand hover:text-brand-dark">
            {t('employer.nav.browse')}
          </Link>
        </div>
      )}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {data.map((talent) => (
          <div key={talent.slug} className="relative">
            <TalentCard talent={talent} />
            <button
              type="button"
              onClick={() => toggle.mutate({ slug: talent.slug, saved: false })}
              aria-label={t('employer.shortlist.remove', { name: talent.firstName })}
              className="absolute right-2 top-2 rounded-full bg-white/90 p-1.5 text-ink/50 shadow-sm hover:text-danger"
            >
              <X className="h-4 w-4" aria-hidden />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
