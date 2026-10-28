'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Copy, Plus } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { useCarePlanTemplates, useDuplicateCarePlanTemplate } from '@/lib/hooks/use-care-plans';
import { fmtDateTime } from '@/lib/colombo-time';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const TABS = ['ACTIVE', 'ARCHIVED'] as const;

/**
 * The care plan template library: the routines staff apply to a booking
 * instead of writing a plan from scratch. ADMIN and STAFF; only admins archive.
 */
export default function CarePlanTemplatesPage() {
  const { t, locale } = useTranslation();
  const { user, loading } = useAuth();
  const router = useRouter();
  const allowed = user?.role === 'ADMIN' || user?.role === 'STAFF';
  const [tab, setTab] = useState<(typeof TABS)[number]>('ACTIVE');
  const { data, isLoading } = useCarePlanTemplates(tab, allowed);
  const duplicate = useDuplicateCarePlanTemplate();

  useEffect(() => {
    if (!loading && user && !allowed) router.replace('/dashboard');
  }, [loading, user, allowed, router]);
  if (loading || !allowed) return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;

  return (
    <div>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-ink">{t('carePlans.templates.title')}</h1>
        <Link href="/care-plans/new" className="inline-flex h-9 items-center gap-2 rounded bg-brand px-4 text-sm font-medium text-white hover:bg-brand-dark">
          <Plus size={16} aria-hidden />
          {t('carePlans.templates.new')}
        </Link>
      </div>
      <p className="mb-6 max-w-3xl text-sm text-ink/60">{t('carePlans.templates.subtitle')}</p>

      <div className="mb-4 flex gap-1 border-b border-border" role="tablist">
        {TABS.map((k) => (
          <button
            key={k}
            role="tab"
            aria-selected={tab === k}
            onClick={() => setTab(k)}
            className={cn('-mb-px border-b-2 px-3 py-2 text-sm font-medium', tab === k ? 'border-brand text-brand-dark' : 'border-transparent text-ink/60 hover:text-ink')}
          >
            {t(`carePlans.templates.tabs.${k}`)}
          </button>
        ))}
      </div>

      {isLoading && <p className="py-8 text-center text-sm text-ink/50">{t('common.loading')}</p>}
      {data && data.length === 0 && (
        <div className="rounded-lg border border-dashed border-border bg-white px-6 py-10 text-center text-sm text-ink/60">
          {tab === 'ACTIVE' ? t('carePlans.templates.empty') : t('carePlans.templates.emptyArchived')}
        </div>
      )}
      {data && data.length > 0 && (
        <ul className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {data.map((tpl) => (
            <li key={tpl.id} className="flex flex-col rounded-lg border border-border bg-white p-4">
              <Link href={`/care-plans/${tpl.id}`} className="font-semibold text-brand-dark hover:underline">
                {tpl.name}
              </Link>
              {tpl.description && <p className="mt-1 line-clamp-2 text-sm text-ink/60">{tpl.description}</p>}
              <p className="mt-2 text-xs text-ink/60">
                {t('carePlans.templates.activityCount', { count: tpl.activityCount })}
                {tpl.criticalCount > 0 && <span className="text-accent"> · {t('carePlans.templates.criticalCount', { count: tpl.criticalCount })}</span>}
              </p>
              {tpl.careTypes.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1">
                  {tpl.careTypes.map((ct) => (
                    <span key={ct} className="rounded-full bg-paper px-2 py-0.5 text-xs text-ink/60">
                      {t(`careTypes.${ct}`)}
                    </span>
                  ))}
                </div>
              )}
              <div className="mt-auto flex items-center justify-between gap-2 pt-3">
                <span className="text-xs text-ink/40">{t('carePlans.templates.updated', { when: fmtDateTime(tpl.updatedAt, locale) })}</span>
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={duplicate.isPending}
                  onClick={() => duplicate.mutate(tpl.id, { onSuccess: (copy) => router.push(`/care-plans/${copy.id}`) })}
                >
                  <Copy size={14} aria-hidden />
                  {t('carePlans.templates.duplicate')}
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
