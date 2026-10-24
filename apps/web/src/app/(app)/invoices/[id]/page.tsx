'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, ChevronLeft, ExternalLink, Eye, Pencil, Printer, RefreshCw, Send, Trash2 } from 'lucide-react';
import { colomboToday, formatLkr } from '@care-platform/shared';
import { DEFAULT_PAYMENT_HOW, PaymentHowFields, paymentHowBody, usePaymentHowLabel, type PaymentHow } from '@/components/billing/payment-how-fields';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { ApiError } from '@/lib/api/client';
import {
  useAddInvoiceNote,
  useAddInvoiceShiftLines,
  useDeleteInvoice,
  useDeletePayment,
  useInvoice,
  useIssueInvoice,
  useRecordPayment,
  useReplaceInvoiceLines,
  useReviseInvoice,
  useSendInvoice,
  useUpdateInvoice,
  useVoidInvoice,
  type InvoiceUpdate,
} from '@/lib/hooks/use-billing';
import { fmtDate, fmtDateTime } from '@/lib/colombo-time';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { InvoiceStatusBadge, OverdueBadge } from '@/components/billing/billing-badges';
import { InvoiceDocument } from '@/components/billing/invoice-document';
import { LineEditor, TotalsBlock, liveTotals, rowProblem, rowsFrom, toInput, type EditableRow } from '@/components/billing/line-editor';
import { cn } from '@/lib/utils';
import type { DiscountType, InvoiceDetail } from '@/lib/api/types';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError && err.message ? err.message : fallback);

/**
 * One invoice. While it is a DRAFT this is an editor: who it is addressed to,
 * every line, discounts and tax, with the totals worked out as you type.
 * Issued, it becomes the document the client got - printable - with its
 * payments, online payment attempts and history alongside.
 */
export default function InvoicePage() {
  const { t } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { data: invoice, isLoading, isError } = useInvoice(id);
  const [preview, setPreview] = useState(false);

  useEffect(() => {
    if (!authLoading && user && user.role !== 'ADMIN' && user.role !== 'STAFF') router.replace('/dashboard');
  }, [authLoading, user, router]);

  if (authLoading || isLoading) return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;
  if (isError || !invoice) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-sm text-ink/60">
        <span>{t('billing.invoice.notFound')}</span>
        <Link href="/invoices" className="text-brand-dark hover:underline">
          {t('billing.invoices.back')}
        </Link>
      </div>
    );
  }
  const draft = invoice.status === 'DRAFT';

  return (
    <div>
      <div className="print:hidden">
        <Link href="/invoices" className="mb-4 inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink">
          <ChevronLeft size={16} />
          {t('billing.invoices.back')}
        </Link>
        <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
          <div>
            <h1 className="flex flex-wrap items-center gap-3 text-xl font-semibold tabular-nums text-ink">
              {invoice.number ?? t('billing.invoice.draftTitle')}
              <InvoiceStatusBadge status={invoice.status} label={t(`billing.invoiceStatus.${invoice.status}`)} />
              {invoice.overdue && <OverdueBadge label={t('billing.overdue')} />}
            </h1>
            <p className="mt-1 flex flex-wrap gap-x-3 text-sm text-ink/60">
              {invoice.client && (
                <Link href={`/clients/${invoice.client.id}`} className="inline-flex items-center gap-1 hover:text-ink hover:underline">
                  {invoice.client.fullName}
                  <ExternalLink size={12} />
                </Link>
              )}
              {invoice.booking && (
                <Link href={`/bookings/${invoice.booking.id}`} className="inline-flex items-center gap-1 tabular-nums hover:text-ink hover:underline">
                  {invoice.booking.reference}
                  <ExternalLink size={12} />
                </Link>
              )}
              <span>{t(`billing.basis.${invoice.basis}.title`)}</span>
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            {draft && (
              <Button variant="secondary" onClick={() => setPreview((v) => !v)}>
                {preview ? <Pencil size={16} aria-hidden /> : <Eye size={16} aria-hidden />}
                {preview ? t('billing.invoice.backToEditing') : t('billing.invoice.preview')}
              </Button>
            )}
            {(!draft || preview) && (
              <Button variant="secondary" onClick={() => window.print()}>
                <Printer size={16} aria-hidden />
                {t('billing.invoice.print')}
              </Button>
            )}
          </div>
        </div>
        {invoice.status === 'VOID' && invoice.voidReason && (
          <p className="mb-4 rounded bg-ink/5 px-3 py-2 text-sm text-ink/70">{t('billing.invoice.voidedBecause', { reason: invoice.voidReason })}</p>
        )}
      </div>

      {draft && !preview ? (
        <DraftEditor key={`${invoice.id}:${invoice.updatedAt}`} invoice={invoice} />
      ) : (
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
          <div className="overflow-x-auto rounded-lg border border-border print:overflow-visible print:border-0">
            <InvoiceDocument invoice={invoice} />
          </div>
          {!draft && (
            <div className="space-y-4 print:hidden">
              <IssuedActions invoice={invoice} />
              <PaymentsCard invoice={invoice} />
              {invoice.checkouts.length > 0 && <OnlinePaymentsCard invoice={invoice} />}
              <HistoryCard invoice={invoice} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// --- draft ---------------------------------------------------------------------

function DraftEditor({ invoice }: { invoice: InvoiceDetail }) {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const saveLines = useReplaceInvoiceLines(invoice.id);
  const update = useUpdateInvoice(invoice.id);
  const addShifts = useAddInvoiceShiftLines(invoice.id);
  const remove = useDeleteInvoice(invoice.id);

  const initialRows = useMemo(() => rowsFrom(invoice.lines), [invoice.lines]);
  const [rows, setRows] = useState<EditableRow[]>(initialRows);
  const [tried, setTried] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const header = {
    billToName: invoice.billToName,
    billToAddress: invoice.billToAddress ?? '',
    billToPhone: invoice.billToPhone ?? '',
    billToEmail: invoice.billToEmail ?? '',
    notes: invoice.notes ?? '',
    language: invoice.language,
    discountType: invoice.discountType ?? ('' as DiscountType | ''),
    discountValue: invoice.discountValue ?? '',
    discountReason: invoice.discountReason ?? '',
    applyTax: Boolean(invoice.taxRate),
  };
  const [h, setH] = useState(header);
  const set = (patch: Partial<typeof header>) => setH((v) => ({ ...v, ...patch }));

  const taxRate = h.applyTax ? (invoice.taxRate ?? invoice.tax.rate) : null;
  const totals = liveTotals(rows, { discountType: h.discountType || null, discountValue: h.discountValue, taxRate });
  const linesDirty = JSON.stringify(toInput(rows, true)) !== JSON.stringify(toInput(initialRows, true));
  const headerDirty = JSON.stringify(h) !== JSON.stringify(header);
  const dirty = linesDirty || headerDirty;
  const pending = saveLines.isPending || update.isPending;
  const err = [saveLines, update, addShifts, remove].find((m) => m.isError)?.error;
  const discountBad = Boolean(h.discountType) && h.discountValue.trim() !== '' && !/^\d{1,10}(\.\d{1,2})?$/.test(h.discountValue.trim());

  const save = async () => {
    setTried(true);
    if (rows.some((r) => rowProblem(r)) || discountBad || !h.billToName.trim()) return;
    if (linesDirty) await saveLines.mutateAsync(toInput(rows, true));
    if (headerDirty) {
      const patch: InvoiceUpdate = {
        billToName: h.billToName.trim(),
        billToAddress: h.billToAddress,
        billToPhone: h.billToPhone,
        billToEmail: h.billToEmail.trim(),
        notes: h.notes,
        language: h.language,
        discountType: h.discountType && h.discountValue.trim() ? h.discountType : null,
        discountValue: h.discountType && h.discountValue.trim() ? h.discountValue.trim() : null,
        discountReason: h.discountReason.trim() || null,
        ...(h.applyTax !== header.applyTax ? { applyTax: h.applyTax } : {}),
      };
      await update.mutateAsync(patch);
    }
  };

  return (
    <div className="space-y-4">
      {invoice.generated && (invoice.generated.skipped > 0 || invoice.generated.added === 0) && invoice.basis !== 'MANUAL' && (
        <p className="rounded border border-border bg-white px-3 py-2 text-sm text-ink/70">
          {t('billing.invoice.generated', { added: invoice.generated.added, skipped: invoice.generated.skipped })}
        </p>
      )}
      {invoice.unpricedLines > 0 && (
        <p className="flex items-start gap-2 rounded border border-accent/30 bg-accent-light px-3 py-2 text-sm text-accent">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
          {t('billing.invoice.unpriced', { count: invoice.unpricedLines })}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('billing.invoice.billTo')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-2">
            <div>
              <Label htmlFor="billToName" required>{t('billing.invoice.name')}</Label>
              <Input id="billToName" maxLength={200} value={h.billToName} onChange={(e) => set({ billToName: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="billToEmail">{t('billing.invoice.email')}</Label>
              <Input id="billToEmail" type="email" maxLength={255} value={h.billToEmail} onChange={(e) => set({ billToEmail: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="billToAddress">{t('billing.invoice.address')}</Label>
              <Input id="billToAddress" maxLength={500} value={h.billToAddress} onChange={(e) => set({ billToAddress: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="billToPhone">{t('billing.invoice.phone')}</Label>
              <Input id="billToPhone" maxLength={40} value={h.billToPhone} onChange={(e) => set({ billToPhone: e.target.value })} />
            </div>
            <p className="text-xs text-ink/50 sm:col-span-2">{t('billing.invoice.billToHint')}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('billing.invoice.detailsTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3 text-sm">
            {invoice.periodStart && invoice.periodEnd && (
              <p className="text-ink/70">{t('billing.invoice.periodLine', { from: fmtDate(invoice.periodStart, locale), to: fmtDate(invoice.periodEnd, locale) })}</p>
            )}
            <div>
              <Label htmlFor="invLanguage">{t('billing.newInvoice.language')}</Label>
              <Select id="invLanguage" value={h.language} onChange={(e) => set({ language: e.target.value as 'en' | 'si' | 'ta' })}>
                {(['en', 'si', 'ta'] as const).map((l) => (
                  <option key={l} value={l}>
                    {t(`requests.detail.language.${l}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="invNotes">{t('billing.invoice.notes')}</Label>
              <Textarea id="invNotes" rows={3} maxLength={2000} value={h.notes} onChange={(e) => set({ notes: e.target.value })} placeholder={t('billing.invoice.notesPlaceholder')} />
            </div>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-wrap items-center justify-between gap-2">
          <CardTitle>
            {t('billing.invoice.lines')} <span className="font-normal text-ink/50">({rows.length})</span>
          </CardTitle>
          {invoice.basis !== 'MANUAL' && (
            <Button size="sm" variant="secondary" disabled={addShifts.isPending || dirty} onClick={() => addShifts.mutate(undefined)} title={dirty ? t('billing.invoice.saveFirst') : undefined}>
              <RefreshCw size={14} aria-hidden />
              {t('billing.invoice.addShifts')}
            </Button>
          )}
        </CardHeader>
        <CardContent className="p-0">
          <LineEditor rows={rows} onChange={setRows} mode="invoice" readOnly={false} withTax={h.applyTax} totals={totals} showProblems={tried} />
        </CardContent>
      </Card>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle>{t('billing.invoice.discountAndTax')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-3">
              <div>
                <Label htmlFor="discountType">{t('billing.invoice.discount')}</Label>
                <Select id="discountType" value={h.discountType} onChange={(e) => set({ discountType: e.target.value as DiscountType | '' })}>
                  <option value="">{t('billing.invoice.noDiscount')}</option>
                  <option value="PERCENT">{t('billing.invoice.discountPercent')}</option>
                  <option value="AMOUNT">{t('billing.invoice.discountAmount')}</option>
                </Select>
              </div>
              <div>
                <Label htmlFor="discountValue">{h.discountType === 'PERCENT' ? '%' : 'LKR'}</Label>
                <Input id="discountValue" inputMode="decimal" disabled={!h.discountType} value={h.discountValue} onChange={(e) => set({ discountValue: e.target.value })} />
                {tried && discountBad && <p className="mt-1 text-xs text-danger">{t('billing.lines.badDiscount')}</p>}
              </div>
              <div>
                <Label htmlFor="discountReason">{t('billing.invoice.discountReason')}</Label>
                <Input id="discountReason" maxLength={200} disabled={!h.discountType} value={h.discountReason} onChange={(e) => set({ discountReason: e.target.value })} placeholder={t('billing.invoice.discountReasonPlaceholder')} />
              </div>
            </div>
            <label className={cn('flex items-start gap-3 text-sm', !invoice.tax.available && !header.applyTax && 'opacity-60')}>
              <input
                type="checkbox"
                className="mt-0.5 h-4 w-4 accent-brand"
                checked={h.applyTax}
                disabled={!invoice.tax.available && !header.applyTax}
                onChange={(e) => set({ applyTax: e.target.checked })}
              />
              <span>
                <span className="font-medium text-ink">{t('billing.invoice.applyTax', { name: invoice.taxName ?? invoice.tax.name, rate: Number(invoice.taxRate ?? invoice.tax.rate) })}</span>
                <span className="block text-xs text-ink/50">{invoice.tax.available || header.applyTax ? t('billing.invoice.taxHint') : t('billing.invoice.taxOff')}</span>
              </span>
            </label>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>{t('billing.totals.title')}</CardTitle>
          </CardHeader>
          <CardContent>
            <TotalsBlock
              totals={totals}
              discountLabel={h.discountType === 'PERCENT' && h.discountValue ? `${Number(h.discountValue)}%` : null}
              taxLabel={taxRate ? `${invoice.taxName ?? invoice.tax.name} ${Number(taxRate)}%` : null}
            />
          </CardContent>
        </Card>
      </div>

      <div className="sticky bottom-0 z-10 -mx-6 flex flex-wrap items-center justify-between gap-3 border-t border-border bg-white/95 px-6 py-3 backdrop-blur">
        <div className="flex flex-wrap items-center gap-2">
          <Button disabled={!dirty || pending} onClick={() => void save().catch(() => undefined)}>
            {pending ? t('common.loading') : t('billing.invoice.save')}
          </Button>
          {dirty && (
            <Button
              variant="secondary"
              onClick={() => {
                setRows(initialRows);
                setH(header);
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
          <Button variant="ghost" className="text-danger" onClick={() => setConfirmDelete(true)}>
            <Trash2 size={16} aria-hidden />
            {t('billing.invoice.deleteDraft')}
          </Button>
          <IssueButton invoice={invoice} disabled={dirty} />
        </div>
      </div>

      {confirmDelete && (
        <ConfirmDialog
          title={t('billing.invoice.deleteDraftTitle')}
          message={t('billing.invoice.deleteDraftMessage')}
          confirmLabel={t('billing.invoice.deleteDraft')}
          tone="danger"
          pending={remove.isPending}
          error={remove.isError ? errorText(remove.error, t('requests.detail.saveFailed')) : null}
          onCancel={() => setConfirmDelete(false)}
          onConfirm={() => remove.mutate(undefined, { onSuccess: () => router.replace('/invoices') })}
        />
      )}
    </div>
  );
}

function IssueButton({ invoice, disabled }: { invoice: InvoiceDetail; disabled: boolean }) {
  const { t } = useTranslation();
  const issue = useIssueInvoice(invoice.id);
  const [open, setOpen] = useState(false);
  const [issueDate, setIssueDate] = useState(colomboToday());
  const [dueDate, setDueDate] = useState('');
  const [notify, setNotify] = useState(true);
  return (
    <>
      <Button disabled={disabled || invoice.lines.length === 0} title={disabled ? t('billing.invoice.saveFirst') : undefined} onClick={() => setOpen(true)}>
        <Send size={16} aria-hidden />
        {t('billing.invoice.issue')}
      </Button>
      {open && (
        <ConfirmDialog
          title={t('billing.invoice.issueTitle')}
          message={t('billing.invoice.issueMessage', { total: formatLkr(invoice.total) })}
          confirmLabel={t('billing.invoice.issue')}
          pending={issue.isPending}
          error={issue.isError ? errorText(issue.error, t('requests.detail.saveFailed')) : null}
          onCancel={() => setOpen(false)}
          onConfirm={() => issue.mutate({ issueDate, ...(dueDate ? { dueDate } : {}), notify }, { onSuccess: () => setOpen(false) })}
        >
          <div className="mb-4 space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="issueDate">{t('billing.doc.issued')}</Label>
                <Input id="issueDate" type="date" value={issueDate} onChange={(e) => setIssueDate(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="dueDate">{t('billing.doc.due')}</Label>
                <Input id="dueDate" type="date" min={issueDate} value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
              </div>
            </div>
            <p className="text-xs text-ink/50">{t('billing.invoice.dueHint')}</p>
            <label className="flex items-center gap-2">
              <input type="checkbox" className="h-4 w-4 accent-brand" checked={notify} onChange={(e) => setNotify(e.target.checked)} />
              {t('billing.invoice.notifyClient')}
            </label>
          </div>
        </ConfirmDialog>
      )}
    </>
  );
}

// --- issued ----------------------------------------------------------------------

function IssuedActions({ invoice }: { invoice: InvoiceDetail }) {
  const { t } = useTranslation();
  const router = useRouter();
  const send = useSendInvoice(invoice.id);
  const voidIt = useVoidInvoice(invoice.id);
  const revise = useReviseInvoice(invoice.id);
  const [mode, setMode] = useState<'void' | 'revise' | null>(null);
  const [reason, setReason] = useState('');
  const [sent, setSent] = useState(false);
  if (invoice.status === 'VOID') return null;
  const unpaid = Number(invoice.amountPaid) === 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('billing.invoice.actions')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="secondary" disabled={send.isPending} onClick={() => send.mutate(undefined, { onSuccess: () => setSent(true) })}>
            <Send size={14} aria-hidden />
            {invoice.status === 'PAID' ? t('billing.invoice.sendReceipt') : t('billing.invoice.sendAgain')}
          </Button>
          {unpaid && invoice.status === 'ISSUED' && (
            <>
              <Button size="sm" variant="secondary" onClick={() => setMode(mode === 'revise' ? null : 'revise')}>
                {t('billing.invoice.revise')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setMode(mode === 'void' ? null : 'void')}>
                {t('billing.invoice.void')}
              </Button>
            </>
          )}
        </div>
        {sent && !send.isError && <p className="text-xs text-brand-dark">{t('billing.invoice.sent')}</p>}
        {!unpaid && invoice.status === 'ISSUED' && <p className="text-xs text-ink/50">{t('billing.invoice.voidNeedsRefund')}</p>}
        {mode && (
          <div className="rounded border border-border bg-paper p-2">
            <Label htmlFor="voidReason" required>
              {t('billing.invoice.reason')}
            </Label>
            <Input id="voidReason" maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />
            <p className="mt-1 text-xs text-ink/50">{t(mode === 'void' ? 'billing.invoice.voidHint' : 'billing.invoice.reviseHint')}</p>
            <div className="mt-2 flex gap-2">
              <Button
                size="sm"
                variant={mode === 'void' ? 'danger' : 'primary'}
                disabled={!reason.trim() || voidIt.isPending || revise.isPending}
                onClick={() =>
                  mode === 'void'
                    ? voidIt.mutate(reason.trim(), { onSuccess: () => setMode(null) })
                    : revise.mutate(reason.trim(), { onSuccess: (copy) => router.push(`/invoices/${copy.id}`) })
                }
              >
                {t(mode === 'void' ? 'billing.invoice.voidConfirm' : 'billing.invoice.reviseConfirm')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setMode(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}
        {[send, voidIt, revise].some((m) => m.isError) && (
          <p role="alert" className="text-sm text-danger">
            {errorText([send, voidIt, revise].find((m) => m.isError)?.error, t('requests.detail.saveFailed'))}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function PaymentsCard({ invoice }: { invoice: InvoiceDetail }) {
  const { t, locale } = useTranslation();
  const record = useRecordPayment(invoice.id);
  const remove = useDeletePayment(invoice.id);
  const [kind, setKind] = useState<'PAYMENT' | 'REFUND' | null>(null);
  const [amount, setAmount] = useState('');
  const [how, setHow] = useState<PaymentHow>(DEFAULT_PAYMENT_HOW);
  const howLabel = usePaymentHowLabel();
  const [paidOn, setPaidOn] = useState(colomboToday());
  const [reference, setReference] = useState('');
  const open = invoice.status === 'ISSUED' || invoice.status === 'PAID';
  const valid = /^\d{1,10}(\.\d{1,2})?$/.test(amount.trim()) && Number(amount) > 0;

  const start = (k: 'PAYMENT' | 'REFUND') => {
    setKind(k);
    setAmount(k === 'PAYMENT' ? invoice.balance : '');
    setReference('');
  };

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle>{t('billing.payments.title')}</CardTitle>
        <span className="text-sm tabular-nums text-ink/60">
          {formatLkr(invoice.amountPaid)} / {formatLkr(invoice.total)}
        </span>
      </CardHeader>
      <CardContent className="space-y-3">
        {invoice.payments.length === 0 && <p className="text-sm text-ink/50">{t('billing.payments.none')}</p>}
        <ul className="divide-y divide-border">
          {invoice.payments.map((p) => (
            <li key={p.id} className="flex items-start justify-between gap-2 py-2 text-sm">
              <div className="min-w-0">
                <p className={cn('font-medium tabular-nums', Number(p.amount) < 0 ? 'text-accent' : 'text-ink')}>{formatLkr(p.amount)}</p>
                <p className="text-xs text-ink/60">
                  {fmtDate(p.paidOn, locale)} · {howLabel(p)}
                  {p.reference && ` · ${p.reference}`}
                </p>
                {p.recordedBy && <p className="text-xs text-ink/40">{t('requests.detail.by', { name: p.recordedBy.fullName })}</p>}
              </div>
              {p.method !== 'PAYHERE' && (
                <button
                  type="button"
                  disabled={remove.isPending}
                  onClick={() => remove.mutate(p.id)}
                  className="rounded p-1.5 text-ink/40 hover:bg-danger-light hover:text-danger"
                  aria-label={t('billing.payments.delete')}
                  title={t('billing.payments.delete')}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </li>
          ))}
        </ul>
        {open && !kind && (
          <div className="flex flex-wrap gap-2">
            {invoice.status === 'ISSUED' && (
              <Button size="sm" onClick={() => start('PAYMENT')}>
                {t('billing.payments.record')}
              </Button>
            )}
            {Number(invoice.amountPaid) > 0 && (
              <Button size="sm" variant="secondary" onClick={() => start('REFUND')}>
                {t('billing.payments.refund')}
              </Button>
            )}
          </div>
        )}
        {kind && (
          <div className="space-y-2 rounded border border-border bg-paper p-3">
            <p className="text-sm font-medium text-ink">{t(kind === 'PAYMENT' ? 'billing.payments.record' : 'billing.payments.refund')}</p>
            <div className="grid grid-cols-2 gap-2">
              <div>
                <Label htmlFor="payAmount" required>{t('billing.payments.amount')}</Label>
                <Input id="payAmount" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </div>
              <div>
                <Label htmlFor="payOn" required>{t('billing.payments.date')}</Label>
                <Input id="payOn" type="date" max={colomboToday()} value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
              </div>
              <PaymentHowFields idPrefix="pay" value={how} onChange={setHow} />
              <div>
                <Label htmlFor="payRef">{t('billing.payments.reference')}</Label>
                <Input id="payRef" maxLength={120} value={reference} onChange={(e) => setReference(e.target.value)} />
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={!valid || record.isPending}
                onClick={() =>
                  record.mutate(
                    { kind, amount: amount.trim(), ...paymentHowBody(how), paidOn, ...(reference.trim() ? { reference: reference.trim() } : {}) },
                    { onSuccess: () => setKind(null) },
                  )
                }
              >
                {t('common.save')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setKind(null)}>
                {t('common.cancel')}
              </Button>
            </div>
          </div>
        )}
        {(record.isError || remove.isError) && (
          <p role="alert" className="text-sm text-danger">
            {errorText(record.error ?? remove.error, t('requests.detail.saveFailed'))}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function OnlinePaymentsCard({ invoice }: { invoice: InvoiceDetail }) {
  const { t, locale } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('billing.online.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        <ul className="divide-y divide-border text-sm">
          {invoice.checkouts.map((c) => (
            <li key={c.id} className="flex items-center justify-between gap-2 py-2">
              <div>
                <p className="tabular-nums text-ink">{formatLkr(c.amount)}</p>
                <p className="text-xs text-ink/50">
                  {fmtDateTime(c.updatedAt, locale)}
                  {c.method && ` · ${c.method}`}
                  {c.mode === 'SANDBOX' && ` · ${t('billing.online.sandbox')}`}
                </p>
              </div>
              <span className={cn('rounded px-2 py-0.5 text-xs font-medium', c.status === 'SUCCESS' ? 'bg-brand text-white' : c.status === 'PENDING' ? 'bg-paper text-ink/60' : 'bg-danger-light text-danger')}>
                {t(`billing.online.status.${c.status}`)}
              </span>
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}

function HistoryCard({ invoice }: { invoice: InvoiceDetail }) {
  const { t, locale } = useTranslation();
  const addNote = useAddInvoiceNote(invoice.id);
  const [note, setNote] = useState('');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('requests.detail.history')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="mb-4"
          onSubmit={(e) => {
            e.preventDefault();
            if (note.trim()) addNote.mutate(note.trim(), { onSuccess: () => setNote('') });
          }}
        >
          <Textarea rows={2} maxLength={2000} placeholder={t('requests.detail.notePlaceholder')} value={note} onChange={(e) => setNote(e.target.value)} aria-label={t('requests.detail.addNote')} />
          <Button type="submit" size="sm" variant="secondary" className="mt-2" disabled={!note.trim() || addNote.isPending}>
            {t('requests.detail.addNote')}
          </Button>
        </form>
        <ol className="space-y-3">
          {[...invoice.events].reverse().map((e) => (
            <li key={e.id} className="border-l-2 border-border pl-3">
              <p className="text-sm text-ink">{t(`billing.event.${e.type}`)}</p>
              {e.note && <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink/70">{e.note}</p>}
              <p className="mt-0.5 text-xs text-ink/50">
                {fmtDateTime(e.createdAt, locale)}
                {e.actor ? ` · ${t('requests.detail.by', { name: e.actor.fullName })}` : ` · ${t('billing.event.system')}`}
              </p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
