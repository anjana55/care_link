'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, ChevronLeft, ExternalLink, Printer, RefreshCw, Trash2 } from 'lucide-react';
import { MANUAL_PAYMENT_METHODS, colomboToday, formatLkr } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { ApiError } from '@/lib/api/client';
import {
  useAddPayoutShiftLines,
  useApprovePayout,
  useDeletePayout,
  usePayPayout,
  usePayout,
  useReopenPayout,
  useReplacePayoutLines,
  useUpdatePayout,
  useVoidPayout,
} from '@/lib/hooks/use-billing';
import { fmtDate } from '@/lib/colombo-time';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { PayoutStatusBadge } from '@/components/billing/billing-badges';
import { LineEditor, TotalsBlock, liveTotals, rowProblem, rowsFrom, toInput, type EditableRow } from '@/components/billing/line-editor';
import type { PaymentMethod, PayoutDetail } from '@/lib/api/types';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError && err.message ? err.message : fallback);

/** One caregiver's payout statement: shape it while a draft, approve it, record the transfer. */
export default function PayoutPage() {
  const { t, locale } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { data: payout, isLoading, isError } = usePayout(id);

  useEffect(() => {
    if (!authLoading && user && user.role !== 'ADMIN' && user.role !== 'STAFF') router.replace('/dashboard');
  }, [authLoading, user, router]);

  if (authLoading || isLoading) return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;
  if (isError || !payout) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-sm text-ink/60">
        <span>{t('billing.payout.notFound')}</span>
        <Link href="/payouts" className="text-brand-dark hover:underline">
          {t('billing.payouts.back')}
        </Link>
      </div>
    );
  }

  return (
    <div>
      <Link href="/payouts" className="mb-4 inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink print:hidden">
        <ChevronLeft size={16} />
        {t('billing.payouts.back')}
      </Link>
      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="hidden text-xs uppercase tracking-wide text-ink/50 print:block">{t('billing.payout.printTitle')}</p>
          <h1 className="flex items-center gap-3 text-xl font-semibold tabular-nums text-ink">
            {payout.reference}
            <PayoutStatusBadge status={payout.status} label={t(`billing.payoutStatus.${payout.status}`)} />
          </h1>
          <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-ink/60">
            {payout.caregiver && (
              <Link href={`/caregivers/${payout.caregiver.id}`} className="inline-flex items-center gap-1 hover:text-ink hover:underline">
                {payout.caregiver.fullName} · {payout.caregiver.registrationNumber}
                <ExternalLink size={12} className="print:hidden" />
              </Link>
            )}
            <span>
              {fmtDate(payout.periodStart, locale)} – {fmtDate(payout.periodEnd, locale)}
            </span>
          </p>
        </div>
        {payout.status !== 'DRAFT' && (
          <Button variant="secondary" className="print:hidden" onClick={() => window.print()}>
            <Printer size={16} aria-hidden />
            {t('billing.invoice.print')}
          </Button>
        )}
      </div>
      {payout.status === 'VOID' && payout.voidReason && <p className="mb-4 rounded bg-ink/5 px-3 py-2 text-sm text-ink/70">{t('billing.invoice.voidedBecause', { reason: payout.voidReason })}</p>}
      {payout.status === 'PAID' && (
        <p className="mb-4 rounded bg-brand-light px-3 py-2 text-sm text-brand-dark">
          {t('billing.payout.paidLine', { date: fmtDate(payout.paidOn!, locale), method: t(`billing.method.${payout.paymentMethod}`) })}
          {payout.paymentReference && ` · ${payout.paymentReference}`}
        </p>
      )}
      <PayoutEditor key={`${payout.id}:${payout.updatedAt}`} payout={payout} />
    </div>
  );
}

function PayoutEditor({ payout }: { payout: PayoutDetail }) {
  const { t } = useTranslation();
  const router = useRouter();
  const draft = payout.status === 'DRAFT';
  const saveLines = useReplacePayoutLines(payout.id);
  const saveNotes = useUpdatePayout(payout.id);
  const addShifts = useAddPayoutShiftLines(payout.id);
  const approve = useApprovePayout(payout.id);
  const reopen = useReopenPayout(payout.id);
  const voidIt = useVoidPayout(payout.id);
  const remove = useDeletePayout(payout.id);
  const pay = usePayPayout(payout.id);

  const initialRows = useMemo(() => rowsFrom(payout.lines), [payout.lines]);
  const [rows, setRows] = useState<EditableRow[]>(initialRows);
  const [notes, setNotes] = useState(payout.notes ?? '');
  const [tried, setTried] = useState(false);
  const [mode, setMode] = useState<'pay' | 'void' | 'delete' | null>(null);
  const [paidOn, setPaidOn] = useState(colomboToday());
  const [method, setMethod] = useState<PaymentMethod>('BANK_TRANSFER');
  const [reference, setReference] = useState('');
  const [notify, setNotify] = useState(true);
  const [reason, setReason] = useState('');

  const totals = liveTotals(rows);
  const linesDirty = JSON.stringify(toInput(rows, false)) !== JSON.stringify(toInput(initialRows, false));
  const notesDirty = notes !== (payout.notes ?? '');
  const dirty = linesDirty || notesDirty;
  const all = [saveLines, saveNotes, addShifts, approve, reopen, voidIt, remove, pay];
  const err = all.find((m) => m.isError)?.error;
  const pending = all.some((m) => m.isPending);

  const save = async () => {
    setTried(true);
    if (rows.some((r) => rowProblem(r))) return;
    if (linesDirty) await saveLines.mutateAsync(toInput(rows, false));
    if (notesDirty) await saveNotes.mutateAsync(notes);
  };

  return (
    <div className="space-y-4">
      {draft && payout.unpricedLines > 0 && (
        <p className="flex items-start gap-2 rounded border border-accent/30 bg-accent-light px-3 py-2 text-sm text-accent print:hidden">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          {t('billing.payout.unpriced', { count: payout.unpricedLines })}
        </p>
      )}
      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>
            {t('billing.invoice.lines')} <span className="font-normal text-ink/50">({rows.length})</span>
          </CardTitle>
          {draft && (
            <Button size="sm" variant="secondary" className="print:hidden" disabled={addShifts.isPending || dirty} onClick={() => addShifts.mutate(undefined)} title={dirty ? t('billing.invoice.saveFirst') : undefined}>
              <RefreshCw size={14} aria-hidden />
              {t('billing.payout.addShifts')}
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <LineEditor rows={rows} onChange={setRows} mode="payout" readOnly={!draft} withTax={false} totals={totals} showProblems={tried} />
          <div className="border-t border-border px-5 py-4">
            <TotalsBlock totals={totals} />
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('billing.payout.notes')}</CardTitle>
        </CardHeader>
        <CardContent>
          {payout.status === 'VOID' ? (
            <p className="whitespace-pre-wrap text-sm text-ink/70">{payout.notes || '—'}</p>
          ) : (
            <Textarea rows={2} maxLength={2000} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t('billing.payout.notesPlaceholder')} />
          )}
        </CardContent>
      </Card>

      {payout.status !== 'VOID' && payout.status !== 'PAID' && (
        <div className="sticky bottom-0 z-10 -mx-6 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-white/95 px-6 py-3 backdrop-blur print:hidden">
          <div className="flex flex-wrap items-center gap-2">
            <Button disabled={!dirty || pending} onClick={() => void save().catch(() => undefined)}>
              {t('billing.invoice.save')}
            </Button>
            {dirty && (
              <Button
                variant="secondary"
                onClick={() => {
                  setRows(initialRows);
                  setNotes(payout.notes ?? '');
                  setTried(false);
                }}
              >
                {t('billing.invoice.discard')}
              </Button>
            )}
            {err && (
              <p role="alert" className="text-sm text-danger">
                {errorText(err, t('requests.detail.saveFailed'))}
              </p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {draft ? (
              <>
                <Button variant="ghost" className="text-danger" onClick={() => setMode('delete')}>
                  <Trash2 size={16} aria-hidden />
                  {t('billing.payout.delete')}
                </Button>
                <Button variant="secondary" onClick={() => setMode('void')}>
                  {t('billing.invoice.void')}
                </Button>
                <Button disabled={dirty || pending || rows.length === 0} title={dirty ? t('billing.invoice.saveFirst') : undefined} onClick={() => approve.mutate(undefined)}>
                  {t('billing.payout.approve')}
                </Button>
              </>
            ) : (
              <>
                <Button variant="secondary" disabled={pending} onClick={() => reopen.mutate(undefined)}>
                  {t('billing.payout.reopen')}
                </Button>
                <Button variant="secondary" onClick={() => setMode('void')}>
                  {t('billing.invoice.void')}
                </Button>
                <Button onClick={() => setMode('pay')}>{t('billing.payout.markPaid')}</Button>
              </>
            )}
          </div>
        </div>
      )}

      {mode === 'pay' && (
        <ConfirmDialog
          title={t('billing.payout.markPaidTitle', { amount: formatLkr(payout.total) })}
          confirmLabel={t('billing.payout.markPaid')}
          pending={pay.isPending}
          error={pay.isError ? errorText(pay.error, t('requests.detail.saveFailed')) : null}
          onCancel={() => setMode(null)}
          onConfirm={() => pay.mutate({ paidOn, method, ...(reference.trim() ? { reference: reference.trim() } : {}), notify }, { onSuccess: () => setMode(null) })}
        >
          <div className="mb-4 space-y-2 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="poDate">{t('billing.payments.date')}</Label>
                <Input id="poDate" type="date" max={colomboToday()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="poMethod">{t('billing.payments.method')}</Label>
                <Select id="poMethod" value={method} onChange={(e) => setMethod(e.target.value as PaymentMethod)}>
                  {MANUAL_PAYMENT_METHODS.map((m) => (
                    <option key={m} value={m}>
                      {t(`billing.method.${m}`)}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            <div>
              <Label htmlFor="poRef">{t('billing.payments.reference')}</Label>
              <Input id="poRef" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} />
            </div>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4 accent-brand" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              {t('billing.payout.notifyCaregiver')}
            </label>
          </div>
        </ConfirmDialog>
      )}
      {mode === 'void' && (
        <ConfirmDialog
          title={t('billing.payout.voidTitle')}
          message={t('billing.payout.voidHint')}
          confirmLabel={t('billing.invoice.voidConfirm')}
          tone="danger"
          pending={voidIt.isPending}
          error={voidIt.isError ? errorText(voidIt.error, t('requests.detail.saveFailed')) : null}
          onCancel={() => setMode(null)}
          onConfirm={() => reason.trim() && voidIt.mutate(reason.trim(), { onSuccess: () => setMode(null) })}
        >
          <div className="mb-4">
            <Label htmlFor="poReason" required>{t('billing.invoice.reason')}</Label>
            <Input id="poReason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
          </div>
        </ConfirmDialog>
      )}
      {mode === 'delete' && (
        <ConfirmDialog
          title={t('billing.payout.deleteTitle')}
          message={t('billing.payout.deleteMessage')}
          confirmLabel={t('billing.payout.delete')}
          tone="danger"
          pending={remove.isPending}
          error={remove.isError ? errorText(remove.error, t('requests.detail.saveFailed')) : null}
          onCancel={() => setMode(null)}
          onConfirm={() => remove.mutate(undefined, { onSuccess: () => router.replace('/payouts') })}
        />
      )}
    </div>
  );
}
