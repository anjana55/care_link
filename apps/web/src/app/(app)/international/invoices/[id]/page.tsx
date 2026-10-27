'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { ChevronLeft, Send, Trash2 } from 'lucide-react';
import { CURRENCY_CODES, placementPaymentMethodValues, type CurrencyCode, type PlacementInvoice, type PlacementPaymentMethod } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { useDeleteDraftInvoice, usePlacementInvoice, usePlacementInvoiceAction } from '@/lib/hooks/use-international';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { day, money } from '@/components/international/shared';
import { INVOICE_STYLES } from '@/components/international/invoices-tab';

const todayColombo = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/**
 * One placement-fee invoice. A draft can be changed, issued (numbered and
 * emailed to the employer) or deleted; an issued one takes payments - bank
 * transfers are recorded here, card payments arrive from PayHere by
 * themselves - and can be voided while nothing has been paid.
 */
export default function PlacementInvoicePage() {
  const { t, locale } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const router = useRouter();
  const { data: inv, isLoading, isError } = usePlacementInvoice(id);

  useEffect(() => {
    if (!loading && user && user.role !== 'ADMIN' && user.role !== 'STAFF') router.replace('/dashboard');
  }, [loading, user, router]);

  if (isLoading || loading) return <p className="py-10 text-center text-sm text-ink/50">{t('common.loading')}</p>;
  if (isError || !inv) return <p className="py-10 text-center text-sm text-danger">{t('international.invoices.notFound')}</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/international?tab=invoices" className="inline-flex items-center gap-1 text-sm text-ink/60 hover:text-brand-dark">
          <ChevronLeft size={16} aria-hidden />
          {t('international.invoices.back')}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold tabular-nums text-ink">{inv.number ?? t('international.invoices.draft')}</h1>
          <span className={cn('rounded px-2 py-0.5 text-xs font-medium', inv.overdue ? 'bg-danger-light text-danger' : INVOICE_STYLES[inv.status])}>
            {inv.overdue ? t('international.invoices.filters.overdue') : t(`international.invoices.filters.${inv.status}`)}
          </span>
        </div>
        <p className="mt-1 text-sm text-ink/60">
          {inv.billToName} ·{' '}
          <Link href={`/international/${inv.enquiryId}`} className="text-brand-dark hover:underline">
            {inv.enquiryReference}
          </Link>
          {inv.placementId && (
            <>
              {' '}
              ·{' '}
              <Link href={`/international/placements/${inv.placementId}`} className="text-brand-dark hover:underline">
                {t('international.invoices.placement')}
              </Link>
            </>
          )}
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {inv.status === 'DRAFT' ? <DraftForm invoice={inv} /> : <Summary invoice={inv} />}
        </div>
        <div className="space-y-6">
          {inv.status === 'DRAFT' && <IssueCard invoice={inv} />}
          {(inv.status === 'ISSUED' || inv.status === 'PAID') && <PaymentCard invoice={inv} />}
          {inv.status === 'ISSUED' && Number(inv.amountPaid) === 0 && <VoidCard invoice={inv} />}
          {inv.payments.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle>{t('international.invoices.payments')}</CardTitle>
              </CardHeader>
              <CardContent>
                <ul className="space-y-2 text-sm">
                  {inv.payments.map((p) => (
                    <li key={p.id} className="flex justify-between gap-3">
                      <span>
                        {day(p.paidOn, locale)} · {t(`international.invoices.method.${p.method}`)}
                        {p.reference && <span className="block text-xs text-ink/50">{p.reference}</span>}
                      </span>
                      <span className={cn('tabular-nums', Number(p.amount) < 0 && 'text-danger')}>{money(p.amount, inv.currency, locale)}</span>
                    </li>
                  ))}
                </ul>
              </CardContent>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}

function Summary({ invoice: inv }: { invoice: PlacementInvoice }) {
  const { t, locale } = useTranslation();
  const rows: [string, React.ReactNode][] = [
    [t('international.invoices.description'), inv.description],
    [t('international.invoices.amount'), money(inv.amount, inv.currency, locale)],
    [t('international.invoices.paid'), money(inv.amountPaid, inv.currency, locale)],
    [t('international.invoices.balance'), inv.status === 'VOID' ? '-' : money(inv.balance, inv.currency, locale)],
    [t('international.invoices.issued'), day(inv.issueDate, locale)],
    [t('international.invoices.due'), day(inv.dueDate, locale)],
    [t('international.invoices.billTo'), [inv.billToName, inv.billToEmail].filter(Boolean).join(' · ')],
  ];
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('international.invoices.invoice')}</CardTitle>
      </CardHeader>
      <CardContent>
        <dl className="grid grid-cols-[9rem_1fr] gap-x-3 gap-y-2 text-sm">
          {rows.map(([label, value]) => (
            <div key={label} className="contents">
              <dt className="text-ink/50">{label}</dt>
              <dd className="tabular-nums text-ink">{value}</dd>
            </div>
          ))}
        </dl>
        {inv.voidReason && <p className="mt-3 text-sm text-danger">{t('international.invoices.voided', { reason: inv.voidReason })}</p>}
        {inv.notes && <p className="mt-3 whitespace-pre-line rounded bg-paper p-3 text-sm text-ink/80">{inv.notes}</p>}
        {inv.employerId ? (
          <p className="mt-3 text-xs text-ink/50">{inv.payOnline ? t('international.invoices.employerCanPay') : t('international.invoices.employerSees')}</p>
        ) : (
          <p className="mt-3 text-xs text-ink/50">{t('international.invoices.noAccount')}</p>
        )}
      </CardContent>
    </Card>
  );
}

function DraftForm({ invoice: inv }: { invoice: PlacementInvoice }) {
  const { t } = useTranslation();
  const action = usePlacementInvoiceAction();
  const [currency, setCurrency] = useState(inv.currency as CurrencyCode);
  const [amount, setAmount] = useState(inv.amount);
  const [description, setDescription] = useState(inv.description);
  const [billToName, setBillToName] = useState(inv.billToName);
  const [billToEmail, setBillToEmail] = useState(inv.billToEmail ?? '');
  const [billToAddress, setBillToAddress] = useState(inv.billToAddress ?? '');
  const [notes, setNotes] = useState(inv.notes ?? '');
  const [saved, setSaved] = useState(false);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('international.invoices.draftTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            setSaved(false);
            action.mutate(
              {
                kind: 'update',
                id: inv.id,
                body: {
                  currency,
                  amount: Number(amount),
                  description: description.trim(),
                  billToName: billToName.trim(),
                  billToEmail: billToEmail.trim() || null,
                  billToAddress: billToAddress.trim() || null,
                  notes: notes.trim() || null,
                },
              },
              { onSuccess: () => setSaved(true) },
            );
          }}
        >
          <div className="grid gap-4 sm:grid-cols-[1fr_8rem]">
            <div>
              <Label htmlFor="inv-amount">{t('international.invoices.amount')}</Label>
              <Input id="inv-amount" type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="inv-currency">{t('international.detail.currency')}</Label>
              <Select id="inv-currency" value={currency} onChange={(e) => setCurrency(e.target.value as CurrencyCode)}>
                {CURRENCY_CODES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="inv-description">{t('international.invoices.description')}</Label>
            <Input id="inv-description" value={description} maxLength={300} onChange={(e) => setDescription(e.target.value)} required />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="inv-billto">{t('international.invoices.billTo')}</Label>
              <Input id="inv-billto" value={billToName} maxLength={200} onChange={(e) => setBillToName(e.target.value)} />
            </div>
            <div>
              <Label htmlFor="inv-email">{t('international.detail.email')}</Label>
              <Input id="inv-email" type="email" value={billToEmail} maxLength={255} onChange={(e) => setBillToEmail(e.target.value)} />
            </div>
          </div>
          <div>
            <Label htmlFor="inv-address">{t('international.invoices.address')}</Label>
            <Textarea id="inv-address" rows={2} value={billToAddress} maxLength={500} onChange={(e) => setBillToAddress(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="inv-notes">{t('international.invoices.notes')}</Label>
            <Textarea id="inv-notes" rows={2} value={notes} maxLength={2000} onChange={(e) => setNotes(e.target.value)} placeholder={t('international.invoices.notesPlaceholder')} />
          </div>
          {action.isError && <p className="text-sm text-danger">{action.error instanceof Error ? action.error.message : t('common.actionFailed')}</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" variant="secondary" disabled={action.isPending}>
              {t('common.save')}
            </Button>
            {saved && <span className="text-sm text-brand-dark">{t('international.detail.saved')}</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function IssueCard({ invoice: inv }: { invoice: PlacementInvoice }) {
  const { t } = useTranslation();
  const router = useRouter();
  const action = usePlacementInvoiceAction();
  const remove = useDeleteDraftInvoice();
  const [confirm, setConfirm] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('international.invoices.issueTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-ink/70">{inv.billToEmail ? t('international.invoices.issueHint', { email: inv.billToEmail }) : t('international.invoices.issueNoEmail')}</p>
        <Button disabled={action.isPending} onClick={() => action.mutate({ kind: 'issue', id: inv.id })}>
          <Send size={14} aria-hidden />
          {t('international.invoices.issue')}
        </Button>
        {action.isError && <p className="text-xs text-danger">{action.error instanceof Error ? action.error.message : t('common.actionFailed')}</p>}
        <div className="border-t border-border pt-3">
          {confirm ? (
            <div className="flex items-center gap-2 text-sm">
              <span>{t('international.invoices.deleteConfirm')}</span>
              <Button size="sm" variant="danger" disabled={remove.isPending} onClick={() => remove.mutate(inv.id, { onSuccess: () => router.push(inv.placementId ? `/international/placements/${inv.placementId}` : '/international?tab=invoices') })}>
                {t('common.confirm')}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>
                {t('common.cancel')}
              </Button>
            </div>
          ) : (
            <Button size="sm" variant="ghost" onClick={() => setConfirm(true)}>
              <Trash2 size={14} aria-hidden />
              {t('international.invoices.deleteDraft')}
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function PaymentCard({ invoice: inv }: { invoice: PlacementInvoice }) {
  const { t } = useTranslation();
  const action = usePlacementInvoiceAction();
  const [amount, setAmount] = useState(inv.balance !== '0.00' ? inv.balance : '');
  const [method, setMethod] = useState<PlacementPaymentMethod>('BANK_TRANSFER');
  const [paidOn, setPaidOn] = useState(todayColombo());
  const [reference, setReference] = useState('');
  const [refund, setRefund] = useState(false);
  return (
    <Card>
      <CardHeader>
        <CardTitle>{refund ? t('international.invoices.recordRefund') : t('international.invoices.recordPayment')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-3"
          onSubmit={(e) => {
            e.preventDefault();
            const n = Math.abs(Number(amount));
            action.mutate(
              { kind: 'payment', id: inv.id, body: { amount: refund ? -n : n, method, paidOn, reference: reference.trim() || null } },
              { onSuccess: (next) => (setAmount(next.balance !== '0.00' ? next.balance : ''), setReference(''), setRefund(false)) },
            );
          }}
        >
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pay-amount">
                {t('international.invoices.amount')} ({inv.currency})
              </Label>
              <Input id="pay-amount" type="number" min={0.01} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required />
            </div>
            <div>
              <Label htmlFor="pay-date">{t('international.invoices.paidOn')}</Label>
              <Input id="pay-date" type="date" value={paidOn} max={todayColombo()} onChange={(e) => setPaidOn(e.target.value)} required />
            </div>
          </div>
          <div>
            <Label htmlFor="pay-method">{t('international.invoices.methodLabel')}</Label>
            <Select id="pay-method" value={method} onChange={(e) => setMethod(e.target.value as PlacementPaymentMethod)}>
              {placementPaymentMethodValues.map((m) => (
                <option key={m} value={m}>
                  {t(`international.invoices.method.${m}`)}
                </option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="pay-ref">{t('international.invoices.reference')}</Label>
            <Input id="pay-ref" value={reference} maxLength={120} onChange={(e) => setReference(e.target.value)} placeholder={t('international.invoices.referencePlaceholder')} />
          </div>
          {Number(inv.amountPaid) > 0 && (
            <label className="flex items-center gap-2 text-xs text-ink/70">
              <input type="checkbox" checked={refund} onChange={(e) => setRefund(e.target.checked)} />
              {t('international.invoices.isRefund')}
            </label>
          )}
          {action.isError && <p className="text-xs text-danger">{action.error instanceof Error ? action.error.message : t('common.actionFailed')}</p>}
          <Button type="submit" size="sm" disabled={action.isPending || !amount}>
            {t('common.save')}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}

function VoidCard({ invoice: inv }: { invoice: PlacementInvoice }) {
  const { t } = useTranslation();
  const action = usePlacementInvoiceAction();
  const [reason, setReason] = useState('');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('international.invoices.voidTitle')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <Textarea rows={2} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t('international.invoices.voidPlaceholder')} />
        {action.isError && <p className="text-xs text-danger">{action.error instanceof Error ? action.error.message : t('common.actionFailed')}</p>}
        <Button size="sm" variant="secondary" disabled={action.isPending || reason.trim().length < 3} onClick={() => action.mutate({ kind: 'void', id: inv.id, reason: reason.trim() })}>
          {t('international.invoices.void')}
        </Button>
      </CardContent>
    </Card>
  );
}
