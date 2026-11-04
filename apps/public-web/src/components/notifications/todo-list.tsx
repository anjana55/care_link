'use client';

import Link from 'next/link';
import { AlertCircle, CalendarClock, ClipboardCheck, FileUp, Receipt, Star } from 'lucide-react';
import { webPathFor, type TodoItem, type TodoKind } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { fmtDate } from '@/lib/colombo-time';
import { cn } from '@/lib/utils';

const ICONS: Record<TodoKind, typeof Receipt> = {
  PAY_INVOICE: Receipt,
  RATE_CAREGIVER: Star,
  TICK_OFF_CARE: ClipboardCheck,
  UPLOAD_DOCUMENT: FileUp,
  DOCUMENT_REJECTED: AlertCircle,
  DOCUMENT_EXPIRING: CalendarClock,
  SHIFT_TODAY: CalendarClock,
};

/** The sentence for one to-do, in the reader's language. */
export function useTodoText() {
  const { t } = useTranslation();
  return (item: TodoItem): string => {
    const p = item.params;
    const document = p.document ? t(`notifications.document.${p.document}`) : '';
    switch (item.kind) {
      case 'PAY_INVOICE':
        return t(p.overdue ? 'notifications.text.PAY_INVOICE_OVERDUE' : 'notifications.text.PAY_INVOICE', { number: String(p.number ?? ''), amount: String(p.amount ?? '') });
      case 'RATE_CAREGIVER':
        return t('notifications.text.RATE_CAREGIVER', { reference: String(p.reference ?? '') });
      case 'TICK_OFF_CARE':
        return t('notifications.text.TICK_OFF_CARE', { count: Number(p.count ?? 0) });
      case 'DOCUMENT_EXPIRING': {
        const days = Number(p.daysLeft ?? 0);
        if (days < 0) return t('notifications.text.DOCUMENT_EXPIRED', { document });
        if (days === 0) return t('notifications.text.DOCUMENT_EXPIRING_TODAY', { document });
        return t('notifications.text.DOCUMENT_EXPIRING', { document, days });
      }
      case 'SHIFT_TODAY':
        return t('notifications.text.SHIFT_TODAY', { time: String(p.time ?? ''), reference: String(p.reference ?? '') });
      default:
        return t(`notifications.text.${item.kind}`, { document });
    }
  };
}

/**
 * Things still waiting on the person, each with one big button. Urgent ones
 * (overdue, expired, today) come first, in a warning colour.
 */
export function TodoList({ items, role, compact = false, onOpen }: { items: TodoItem[]; role: string; compact?: boolean; onOpen?: () => void }) {
  const { t, locale } = useTranslation();
  const text = useTodoText();
  if (!items.length) return <p className="py-2 text-sm text-ink/60">{t('notifications.todoEmpty')}</p>;
  return (
    <ul className="space-y-2">
      {items.map((item) => {
        const Icon = ICONS[item.kind] ?? AlertCircle;
        return (
          <li
            key={item.key}
            className={cn(
              'flex flex-wrap items-center gap-3 rounded-lg border p-3',
              item.urgent ? 'border-amber-300 bg-amber-50' : 'border-border bg-white',
            )}
          >
            <Icon className={cn('h-5 w-5 shrink-0', item.urgent ? 'text-amber-600' : 'text-brand')} aria-hidden />
            <div className="min-w-0 flex-1">
              <p className={cn('font-medium text-ink', compact ? 'text-sm' : 'text-base')}>{text(item)}</p>
              {item.dueOn && item.kind === 'PAY_INVOICE' && <p className="text-xs text-ink/60">{t('notifications.due', { date: fmtDate(item.dueOn, locale) })}</p>}
            </div>
            <Link
              href={webPathFor(item.path, role)}
              onClick={onOpen}
              className="inline-flex min-h-11 shrink-0 items-center rounded-DEFAULT bg-brand px-4 text-sm font-semibold text-white hover:bg-brand-dark focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2"
            >
              {t(`notifications.action.${item.kind}`)}
            </Link>
          </li>
        );
      })}
    </ul>
  );
}
