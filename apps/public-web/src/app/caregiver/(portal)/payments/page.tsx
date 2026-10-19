'use client';

import { useState } from 'react';
import { ChevronDown } from 'lucide-react';
import { formatLkr } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useMyPayouts } from '@/lib/hooks/use-caregiver-portal';
import { fmtDate } from '@/lib/colombo-time';

/**
 * The caregiver's payout statements: what they are being paid for which
 * shifts, and when it was sent. Read-only - staff prepare and pay them, and
 * only approved or paid statements are shown.
 */
export default function PaymentsPage() {
  const { t, locale } = useTranslation();
  const { data, isLoading, isError } = useMyPayouts();
  const [open, setOpen] = useState<string | null>(null);

  return (
    <section className="rounded-lg border border-border bg-white p-5" aria-labelledby="payments-title">
      <h1 id="payments-title" className="text-base font-semibold text-ink">
        {t('portal.payments.title')}
      </h1>
      <p className="mt-1 text-sm text-ink/60">{t('portal.payments.subtitle')}</p>
      <div className="mt-4">
        {isLoading && <p className="text-sm text-ink/50">{t('common.loading')}</p>}
        {isError && <p className="text-sm text-danger">{t('care.actionError')}</p>}
        {data && data.length === 0 && <p className="text-sm text-ink/50">{t('portal.payments.empty')}</p>}
        {data && data.length > 0 && (
          <ul className="divide-y divide-border rounded border border-border">
            {data.map((p) => {
              const expanded = open === p.id;
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    aria-expanded={expanded}
                    onClick={() => setOpen(expanded ? null : p.id)}
                    className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left hover:bg-paper"
                  >
                    <span className="min-w-0">
                      <span className="block text-sm font-medium text-ink">
                        {fmtDate(p.periodStart, locale)} – {fmtDate(p.periodEnd, locale)}
                      </span>
                      <span className="block text-xs tabular-nums text-ink/50">
                        {p.reference}
                        {p.status === 'PAID' && p.paidOn && ` · ${t('portal.payments.paidOn', { date: fmtDate(p.paidOn, locale) })}`}
                      </span>
                    </span>
                    <span className="flex items-center gap-3">
                      <span className="text-sm font-semibold tabular-nums text-ink">{formatLkr(p.total)}</span>
                      <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${p.status === 'PAID' ? 'bg-brand-light text-brand-dark' : 'bg-accent-light text-accent'}`}>
                        {t(`portal.payments.status.${p.status}`)}
                      </span>
                      <ChevronDown size={16} className={`text-ink/40 transition-transform ${expanded ? 'rotate-180' : ''}`} aria-hidden />
                    </span>
                  </button>
                  {expanded && (
                    <div className="border-t border-border bg-paper/50 px-4 py-3">
                      <ul className="space-y-1 text-sm">
                        {p.lines.map((l, i) => (
                          <li key={i} className="flex justify-between gap-3">
                            <span className="text-ink/80">
                              {l.serviceDate && <span className="mr-2 tabular-nums text-ink/50">{fmtDate(l.serviceDate, locale)}</span>}
                              {l.description}
                            </span>
                            <span className={`whitespace-nowrap tabular-nums ${Number(l.amount) < 0 ? 'text-accent' : 'text-ink'}`}>{formatLkr(l.amount)}</span>
                          </li>
                        ))}
                      </ul>
                      {p.status === 'PAID' && p.paymentReference && (
                        <p className="mt-2 text-xs text-ink/50">{t('portal.payments.reference', { reference: p.paymentReference })}</p>
                      )}
                      {p.status === 'APPROVED' && <p className="mt-2 text-xs text-ink/50">{t('portal.payments.approvedHint')}</p>}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </section>
  );
}
