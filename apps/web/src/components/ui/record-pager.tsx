'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { api } from '@/lib/api/client';
import { useTranslation } from '@/lib/i18n/provider';
import { pagePath, readTrail, saveTrail, type ListPage, type Trail, type TrailKind } from '@/lib/record-trail';
import { cn } from '@/lib/utils';

/**
 * ‹ Previous · 3 of 120 · Next › on a record's page, stepping through the
 * list it was opened from (see lib/record-trail). Renders nothing when the
 * record wasn't opened from that list.
 *
 * Alt+← / Alt+→ do the same, unless the cursor is in a field.
 */
export function RecordPager({ kind, id, className }: { kind: TrailKind; id: string; className?: string }) {
  const { t } = useTranslation();
  const router = useRouter();
  const [trail, setTrail] = useState<Trail | null>(null);
  const [busy, setBusy] = useState<'prev' | 'next' | null>(null);
  const [failed, setFailed] = useState(false);

  // Read after mount (sessionStorage), and again on every record: stepping may have loaded a new page.
  useEffect(() => {
    setTrail(readTrail(kind));
    setFailed(false);
  }, [kind, id]);

  const index = trail ? trail.ids.indexOf(id) : -1;
  const position = trail && index >= 0 ? (trail.page - 1) * trail.pageSize + index + 1 : 0;
  const hasPrev = Boolean(trail && index >= 0 && (index > 0 || trail.page > 1));
  const hasNext = Boolean(trail && index >= 0 && (index < trail.ids.length - 1 || trail.page < trail.totalPages));

  async function go(direction: 'prev' | 'next') {
    if (!trail || index < 0 || busy) return;
    const step = direction === 'next' ? 1 : -1;
    const within = trail.ids[index + step];
    if (within) {
      router.push(`/${kind}/${within}`);
      return;
    }
    // Off the end of this page: load the neighbouring page of the same list.
    setBusy(direction);
    try {
      const page = trail.page + step;
      const path = pagePath(trail.apiPath, page);
      const list = await api.get<ListPage>(path);
      const target = direction === 'next' ? list.items[0] : list.items[list.items.length - 1];
      if (!target) throw new Error('empty page');
      saveTrail(kind, path, list);
      router.push(`/${kind}/${target.id}`);
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!e.altKey || (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight')) return;
      const el = e.target as HTMLElement | null;
      if (el && (el.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(el.tagName))) return;
      e.preventDefault();
      if (e.key === 'ArrowLeft' && hasPrev) void go('prev');
      if (e.key === 'ArrowRight' && hasNext) void go('next');
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  });

  if (!trail || index < 0) return null;

  const button = 'inline-flex h-8 items-center gap-1 rounded border border-border bg-white px-2.5 text-sm text-ink hover:bg-paper disabled:pointer-events-none disabled:opacity-40';
  return (
    <nav aria-label={t('recordPager.label')} className={cn('flex items-center gap-2', className)}>
      <button type="button" className={button} disabled={!hasPrev || busy !== null} onClick={() => void go('prev')} title={`${t('recordPager.previous')} (Alt+←)`}>
        <ChevronLeft size={15} aria-hidden />
        <span className="hidden sm:inline">{t('recordPager.previous')}</span>
        <span className="sr-only sm:hidden">{t('recordPager.previous')}</span>
      </button>
      <span className="whitespace-nowrap text-xs tabular-nums text-ink/55" aria-live="polite">
        {failed ? t('recordPager.failed') : t('recordPager.position', { n: position.toLocaleString(), total: trail.total.toLocaleString() })}
      </span>
      <button type="button" className={button} disabled={!hasNext || busy !== null} onClick={() => void go('next')} title={`${t('recordPager.next')} (Alt+→)`}>
        <span className="hidden sm:inline">{t('recordPager.next')}</span>
        <span className="sr-only sm:hidden">{t('recordPager.next')}</span>
        <ChevronRight size={15} aria-hidden />
      </button>
    </nav>
  );
}
