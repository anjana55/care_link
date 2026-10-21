'use client';

import { useState } from 'react';
import Link from 'next/link';
import { formatLkr } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { useBookingCorrections, useCloseAdjustment, useCloseIssueReport } from '@/lib/hooks/use-bookings';
import { fmtDateTime, fmtDay } from '@/lib/colombo-time';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import type { BillingAdjustmentView, IssueReportView } from '@/lib/api/types';

/**
 * What clients and caregivers have reported on the booking, the booking's
 * corrections - why, by whom, and what each did to the documents - and the
 * money they left waiting for the next invoice or pay statement.
 *
 * An open report is answered with a correction (Correct from it) or a note
 * (resolved another way, or nothing to change); either way the reporter is
 * told. An adjustment not yet on a document can be closed by hand: settled
 * some other way (a cash refund, a transfer) or dropped.
 */
export function BookingCorrections({ bookingId, canCorrect, onCorrectFrom }: { bookingId: string; canCorrect: boolean; onCorrectFrom: (issue: IssueReportView) => void }) {
  const { t, locale } = useTranslation();
  const { data } = useBookingCorrections(bookingId);
  if (!data || (data.amendments.length === 0 && data.adjustments.length === 0 && data.reports.length === 0)) return null;
  const docTitle = (kind: 'INVOICE' | 'PAYOUT', label: string | null) =>
    kind === 'INVOICE' ? (label ? t('bookings.correct.invoice', { label }) : t('bookings.correct.draftInvoice')) : t('bookings.correct.payout', { label: label ?? '' });

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('bookings.correct.historyTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {data.reports.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-ink/50">{t('bookings.issues.title')}</h3>
            <ul className="divide-y divide-border">
              {data.reports.map((r) => (
                <ReportRow key={r.id} bookingId={bookingId} report={r} canCorrect={canCorrect} onCorrect={() => onCorrectFrom(r)} />
              ))}
            </ul>
          </div>
        )}
        {data.adjustments.length > 0 && (
          <div>
            <h3 className="mb-1 text-xs font-medium uppercase tracking-wide text-ink/50">{t('bookings.correct.adjustmentsTitle')}</h3>
            <ul className="divide-y divide-border">
              {data.adjustments.map((a) => (
                <AdjustmentRow key={a.id} bookingId={bookingId} adjustment={a} />
              ))}
            </ul>
          </div>
        )}
        <ol className="space-y-3">
          {data.amendments.map((a) => (
            <li key={a.id} className="border-l-2 border-accent/50 pl-3">
              <p className="whitespace-pre-wrap text-sm text-ink">{a.reason}</p>
              <ul className="mt-1 space-y-0.5 text-xs text-ink/70">
                {a.summary.changes.map((c, i) => (
                  <li key={i}>
                    {c.date ? `${c.date}: ` : ''}
                    {c.changes.join('; ')}
                  </li>
                ))}
                {a.summary.documents.map((d) => (
                  <li key={d.id}>
                    <Link href={d.kind === 'INVOICE' ? `/invoices/${d.id}` : `/payouts/${d.id}`} className="text-brand-dark hover:underline">
                      {docTitle(d.kind, d.label)}
                    </Link>
                    : {t(`bookings.correct.done.${d.action}`)} ({formatLkr(d.difference)})
                    {d.replacementId && (
                      <>
                        {' · '}
                        <Link href={`/invoices/${d.replacementId}`} className="text-brand-dark hover:underline">
                          {t('bookings.correct.replacement')}
                        </Link>
                      </>
                    )}
                  </li>
                ))}
              </ul>
              <p className="mt-0.5 text-xs text-ink/50">
                {fmtDateTime(a.createdAt, locale)}
                {a.actor && ` · ${t('requests.detail.by', { name: a.actor.fullName })}`}
              </p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}

function ReportRow({ bookingId, report: r, canCorrect, onCorrect }: { bookingId: string; report: IssueReportView; canCorrect: boolean; onCorrect: () => void }) {
  const { t, locale } = useTranslation();
  const close = useCloseIssueReport(bookingId);
  const [answering, setAnswering] = useState(false);
  const [status, setStatus] = useState<'RESOLVED' | 'DISMISSED'>('DISMISSED');
  const [note, setNote] = useState('');
  const open = r.status === 'OPEN';

  return (
    <li className={cn('py-2 text-sm', open && 'rounded bg-accent-light/40 px-2')}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-ink">
            <span className="font-medium">
              {t(`bookings.issues.role.${r.reporterRole}`)}
              {r.reporterName ? ` · ${r.reporterName}` : ''}
            </span>
            <span className="ml-1 text-xs text-ink/50">
              {t(`bookings.issues.category.${r.category}`)}
              {r.shiftStartsAt ? ` · ${fmtDay(r.shiftStartsAt, locale)}` : ''}
            </span>
          </p>
          <p className="mt-0.5 whitespace-pre-wrap text-ink/80">{r.message}</p>
        </div>
        <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-xs font-medium', open ? 'bg-accent-light text-accent' : 'bg-paper text-ink/60')}>
          {t(`bookings.issues.status.${r.status}`)}
        </span>
      </div>
      {r.resolutionNote && <p className="mt-1 text-xs text-ink/60">{t('bookings.issues.answer', { note: r.resolutionNote })}</p>}
      <p className="mt-0.5 text-xs text-ink/50">
        {fmtDateTime(r.createdAt, locale)}
        {r.closedBy && ` · ${t('bookings.issues.closedBy', { name: r.closedBy.fullName })}`}
      </p>
      {open && !answering && (
        <div className="mt-1 flex gap-3 text-xs">
          {canCorrect && (
            <button type="button" className="font-medium text-brand-dark hover:underline" onClick={onCorrect}>
              {t('bookings.issues.correctFrom')}
            </button>
          )}
          <button type="button" className="text-brand-dark hover:underline" onClick={() => setAnswering(true)}>
            {t('bookings.issues.answerWithout')}
          </button>
        </div>
      )}
      {answering && (
        <div className="mt-2 space-y-2">
          <div className="flex flex-wrap gap-3 text-sm" role="radiogroup" aria-label={t('bookings.issues.answerWithout')}>
            {(['DISMISSED', 'RESOLVED'] as const).map((st) => (
              <label key={st} className="flex items-center gap-1.5">
                <input type="radio" name={`close-${r.id}`} checked={status === st} onChange={() => setStatus(st)} />
                {t(`bookings.issues.closeAs.${st}`)}
              </label>
            ))}
          </div>
          <Textarea rows={2} maxLength={500} autoFocus placeholder={t('bookings.issues.notePlaceholder')} aria-label={t('bookings.issues.notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} />
          <div className="flex gap-2">
            <Button size="sm" disabled={note.trim().length < 3 || close.isPending} onClick={() => close.mutate({ id: r.id, status, note: note.trim() }, { onSuccess: () => setAnswering(false) })}>
              {t('bookings.issues.send')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setAnswering(false)}>
              {t('common.cancel')}
            </Button>
          </div>
          <p className="text-xs text-ink/50">{t('bookings.issues.sentTo')}</p>
        </div>
      )}
      {close.isError && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {close.error instanceof ApiError && close.error.message ? close.error.message : t('requests.detail.saveFailed')}
        </p>
      )}
    </li>
  );
}

function AdjustmentRow({ bookingId, adjustment: a }: { bookingId: string; adjustment: BillingAdjustmentView }) {
  const { t } = useTranslation();
  const close = useCloseAdjustment(bookingId);
  const [mode, setMode] = useState<'settle' | 'cancel' | null>(null);
  const [reason, setReason] = useState('');
  const on = a.appliedTo;
  const statusText =
    a.status === 'APPLIED' && on
      ? t('bookings.correct.adjustmentStatus.APPLIED', { doc: on.kind === 'INVOICE' ? (on.label ?? t('bookings.correct.draftInvoice')) : (on.label ?? '') })
      : t(`bookings.correct.adjustmentStatus.${a.status}`);

  return (
    <li className="py-2 text-sm">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="min-w-0 text-ink/80">
          {t(a.side === 'CLIENT' ? 'bookings.correct.adjustmentClient' : 'bookings.correct.adjustmentCaregiver', { name: a.partyName ?? '—' })}
          <span className="ml-1 text-xs text-ink/50">
            {a.sourceLabel ? `${a.sourceLabel} · ` : ''}
            {a.description}
          </span>
        </span>
        <span className="flex items-center gap-2">
          <span className={cn('tabular-nums font-medium', a.amount.startsWith('-') ? 'text-danger' : 'text-brand-dark')}>{formatLkr(a.amount)}</span>
          {on ? (
            <Link href={on.kind === 'INVOICE' ? `/invoices/${on.id}` : `/payouts/${on.id}`} className="text-xs text-brand-dark hover:underline">
              {statusText}
            </Link>
          ) : (
            <span className="text-xs text-ink/50">{statusText}</span>
          )}
        </span>
      </div>
      {a.closedNote && <p className="mt-0.5 text-xs text-ink/50">{a.closedNote}</p>}
      {a.status === 'OPEN' && !mode && (
        <div className="mt-1 flex gap-3 text-xs">
          <button type="button" className="text-brand-dark hover:underline" onClick={() => setMode('settle')}>
            {t('bookings.correct.settle')}
          </button>
          <button type="button" className="text-ink/50 hover:text-danger hover:underline" onClick={() => setMode('cancel')}>
            {t('bookings.correct.cancelAdj')}
          </button>
        </div>
      )}
      {mode && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Input
            className="h-8 min-w-56 flex-1 text-sm"
            autoFocus
            maxLength={500}
            placeholder={t(mode === 'settle' ? 'bookings.correct.settleReason' : 'bookings.correct.cancelReason')}
            aria-label={t(mode === 'settle' ? 'bookings.correct.settleReason' : 'bookings.correct.cancelReason')}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <Button size="sm" disabled={!reason.trim() || close.isPending} onClick={() => close.mutate({ id: a.id, outcome: mode, reason: reason.trim() }, { onSuccess: () => setMode(null) })}>
            {t('common.save')}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setMode(null)}>
            {t('common.cancel')}
          </Button>
        </div>
      )}
      {close.isError && (
        <p role="alert" className="mt-1 text-xs text-danger">
          {close.error instanceof ApiError && close.error.message ? close.error.message : t('requests.detail.saveFailed')}
        </p>
      )}
    </li>
  );
}
