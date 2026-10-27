'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AlertCircle, CheckCircle2, ChevronLeft, FilePlus2, ShieldCheck } from 'lucide-react';
import {
  CURRENCY_CODES,
  checkinOutcomeValues,
  placementStatusValues,
  type CheckinOutcome,
  type PlacementCheckin,
  type PlacementStatus,
  type PlacementUpdate,
  type StaffPlacement,
} from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { usePlacement, usePlacementInvoiceAction, useRecordCheckin, useUpdatePlacement } from '@/lib/hooks/use-international';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';
import { countryName, day, money } from '@/components/international/shared';
import { PLACEMENT_STYLES } from '@/components/international/placements-tab';
import { INVOICE_STYLES } from '@/components/international/invoices-tab';

const todayColombo = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/**
 * One placement: the dates staff keep up to date as the caregiver travels,
 * the welfare check-ins after arrival, how it ended, and the fee invoice.
 */
export default function PlacementPage() {
  const { t, locale } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { user, loading } = useAuth();
  const router = useRouter();
  const { data: p, isLoading, isError } = usePlacement(id);

  useEffect(() => {
    if (!loading && user && user.role !== 'ADMIN' && user.role !== 'STAFF') router.replace('/dashboard');
  }, [loading, user, router]);

  if (isLoading || loading) return <p className="py-10 text-center text-sm text-ink/50">{t('common.loading')}</p>;
  if (isError || !p) return <p className="py-10 text-center text-sm text-danger">{t('international.placements.notFound')}</p>;

  return (
    <div className="space-y-6">
      <div>
        <Link href="/international?tab=placements" className="inline-flex items-center gap-1 text-sm text-ink/60 hover:text-brand-dark">
          <ChevronLeft size={16} aria-hidden />
          {t('international.placements.back')}
        </Link>
        <div className="mt-2 flex flex-wrap items-center gap-3">
          <h1 className="text-xl font-semibold text-ink">
            <Link href={`/caregivers/${p.caregiverId}`} className="hover:underline">
              {p.fullName}
            </Link>{' '}
            · {p.organisationName}
          </h1>
          <span className={cn('rounded px-2 py-0.5 text-xs font-medium', PLACEMENT_STYLES[p.status])}>{t(`international.placements.status.${p.status}`)}</span>
        </div>
        <p className="mt-1 text-sm text-ink/60">
          {countryName(p.country, locale)}
          {p.jobTitle && ` · ${p.jobTitle}`} ·{' '}
          <Link href={`/international/${p.enquiryId}`} className="text-brand-dark hover:underline">
            {p.enquiryReference}
          </Link>
        </p>
        {p.guaranteeEndsOn && (
          <p className="mt-1 flex items-center gap-1.5 text-xs text-ink/60">
            <ShieldCheck size={14} className="text-brand" aria-hidden />
            {t('international.placements.guarantee', { date: day(p.guaranteeEndsOn, locale) })}
          </p>
        )}
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <CheckinsCard placement={p} />
        <InvoicesCard placement={p} />
      </div>
      <PlacementForm placement={p} />
    </div>
  );
}

function CheckinsCard({ placement: p }: { placement: StaffPlacement }) {
  const { t } = useTranslation();
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('international.placements.checkins')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!p.checkins.length && <p className="text-sm text-ink/50">{t('international.placements.noCheckins')}</p>}
        {p.checkins.map((c) => (
          <CheckinRow key={c.id} placement={p} checkin={c} />
        ))}
      </CardContent>
    </Card>
  );
}

function CheckinRow({ placement: p, checkin: c }: { placement: StaffPlacement; checkin: PlacementCheckin }) {
  const { t, locale } = useTranslation();
  const record = useRecordCheckin(p.id);
  const [open, setOpen] = useState(false);
  const [completedOn, setCompletedOn] = useState(c.completedOn ?? todayColombo());
  const [outcome, setOutcome] = useState<CheckinOutcome | ''>(c.outcome ?? '');
  const [note, setNote] = useState(c.note ?? '');
  const overdue = !c.completedOn && c.dueOn < todayColombo() && (p.status === 'DEPLOYED' || p.status === 'PRE_DEPARTURE');

  return (
    <div className={cn('rounded border p-3', overdue ? 'border-danger/40 bg-danger-light/30' : 'border-border')}>
      <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
        <span className="font-medium text-ink">{t(`international.placements.checkin.${c.kind}`)}</span>
        {c.completedOn ? (
          <span className="flex items-center gap-1.5 text-xs">
            <CheckCircle2 size={14} className={c.outcome === 'URGENT' ? 'text-danger' : c.outcome === 'CONCERN' ? 'text-accent' : 'text-brand'} aria-hidden />
            {day(c.completedOn, locale)} · {c.outcome ? t(`international.placements.outcome.${c.outcome}`) : ''}
          </span>
        ) : (
          <span className={cn('flex items-center gap-1 text-xs', overdue ? 'font-medium text-danger' : 'text-ink/60')}>
            {overdue && <AlertCircle size={13} aria-hidden />}
            {t('international.placements.due', { date: day(c.dueOn, locale) })}
          </span>
        )}
      </div>
      {c.note && !open && <p className="mt-1 text-xs text-ink/70">{c.note}</p>}
      {open ? (
        <form
          className="mt-3 space-y-2"
          onSubmit={(e) => {
            e.preventDefault();
            record.mutate({ checkinId: c.id, completedOn, outcome: outcome || null, note: note.trim() || null }, { onSuccess: () => setOpen(false) });
          }}
        >
          <div className="grid gap-2 sm:grid-cols-2">
            <div>
              <Label htmlFor={`ci-date-${c.id}`}>{t('international.placements.calledOn')}</Label>
              <Input id={`ci-date-${c.id}`} type="date" value={completedOn} max={todayColombo()} onChange={(e) => setCompletedOn(e.target.value)} />
            </div>
            <div>
              <Label htmlFor={`ci-outcome-${c.id}`}>{t('international.placements.howAreThey')}</Label>
              <Select id={`ci-outcome-${c.id}`} value={outcome} onChange={(e) => setOutcome(e.target.value as CheckinOutcome)}>
                <option value="" />
                {checkinOutcomeValues.map((o) => (
                  <option key={o} value={o}>
                    {t(`international.placements.outcome.${o}`)}
                  </option>
                ))}
              </Select>
            </div>
          </div>
          <Textarea rows={2} maxLength={1000} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('international.placements.notePlaceholder')} />
          {outcome === 'URGENT' && <p className="text-xs text-danger">{t('international.placements.urgentHint')}</p>}
          {record.isError && <p className="text-xs text-danger">{record.error instanceof Error ? record.error.message : t('common.actionFailed')}</p>}
          <div className="flex gap-2">
            <Button type="submit" size="sm" disabled={record.isPending}>
              {t('common.save')}
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => setOpen(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        </form>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="mt-2 text-xs font-medium text-brand-dark hover:underline">
          {c.completedOn ? t('international.placements.editCheckin') : t('international.placements.recordCheckin')}
        </button>
      )}
    </div>
  );
}

function InvoicesCard({ placement: p }: { placement: StaffPlacement }) {
  const { t, locale } = useTranslation();
  const router = useRouter();
  const create = usePlacementInvoiceAction();
  const live = p.invoices.filter((i) => i.status !== 'VOID');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('international.placements.invoices')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!p.invoices.length && <p className="text-sm text-ink/50">{t('international.placements.noInvoices')}</p>}
        <ul className="space-y-2">
          {p.invoices.map((i) => (
            <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-3 py-2 text-sm">
              <Link href={`/international/invoices/${i.id}`} className="font-medium tabular-nums text-brand-dark hover:underline">
                {i.number ?? t('international.invoices.draft')}
              </Link>
              <span className="flex items-center gap-2">
                <span className="tabular-nums">{money(i.amount, i.currency, locale)}</span>
                <span className={cn('rounded px-2 py-0.5 text-xs font-medium', i.overdue ? 'bg-danger-light text-danger' : INVOICE_STYLES[i.status])}>
                  {i.overdue ? t('international.invoices.filters.overdue') : t(`international.invoices.filters.${i.status}`)}
                </span>
              </span>
            </li>
          ))}
        </ul>
        {!live.length && (
          <div className="space-y-2">
            {p.feeAmount === null && <p className="text-xs text-ink/60">{t('international.placements.setFeeFirst')}</p>}
            <Button
              size="sm"
              disabled={create.isPending || p.feeAmount === null || !p.feeCurrency}
              onClick={() =>
                create.mutate(
                  {
                    kind: 'create',
                    body: {
                      placementId: p.id,
                      currency: p.feeCurrency as (typeof CURRENCY_CODES)[number],
                      amount: p.feeAmount!,
                      description: t('international.placements.invoiceDescription', { name: p.fullName.split(' ')[0], job: p.jobTitle ?? t(`international.placements.caregiverRole`) }),
                    },
                  },
                  { onSuccess: (inv) => router.push(`/international/invoices/${inv.id}`) },
                )
              }
            >
              <FilePlus2 size={14} aria-hidden />
              {t('international.placements.raiseInvoice')}
            </Button>
            {create.isError && <p className="text-xs text-danger">{create.error instanceof Error ? create.error.message : t('common.actionFailed')}</p>}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function PlacementForm({ placement: p }: { placement: StaffPlacement }) {
  const { t } = useTranslation();
  const update = useUpdatePlacement(p.id);
  const [f, setF] = useState(() => toForm(p));
  const [saved, setSaved] = useState(false);
  useEffect(() => setF(toForm(p)), [p]);
  const set = (patch: Partial<ReturnType<typeof toForm>>) => {
    setSaved(false);
    setF((prev) => ({ ...prev, ...patch }));
  };
  const field = (key: 'departureOn' | 'arrivedOn' | 'contractStartOn' | 'endedOn', label: string) => (
    <div>
      <Label htmlFor={`pl-${key}`}>{label}</Label>
      <Input id={`pl-${key}`} type="date" value={f[key]} onChange={(e) => set({ [key]: e.target.value })} />
    </div>
  );

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('international.placements.details')}</CardTitle>
      </CardHeader>
      <CardContent>
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            const body: PlacementUpdate = {
              status: f.status,
              jobTitle: f.jobTitle.trim() || null,
              departureOn: f.departureOn || null,
              arrivedOn: f.arrivedOn || null,
              contractStartOn: f.contractStartOn || null,
              contractMonths: f.contractMonths ? Number(f.contractMonths) : null,
              endedOn: f.endedOn || null,
              endReason: f.endReason.trim() || null,
              guaranteeMonths: Number(f.guaranteeMonths) || 0,
              feeAmount: f.feeAmount === '' ? null : Number(f.feeAmount),
              feeCurrency: f.feeAmount === '' ? null : f.feeCurrency,
              staffNote: f.staffNote.trim() || null,
            };
            update.mutate(body, { onSuccess: () => setSaved(true) });
          }}
        >
          <div className="grid gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="pl-status">{t('international.enquiries.status')}</Label>
              <Select id="pl-status" value={f.status} onChange={(e) => set({ status: e.target.value as PlacementStatus })}>
                {placementStatusValues.map((s) => (
                  <option key={s} value={s}>
                    {t(`international.placements.status.${s}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="pl-job">{t('international.placements.jobTitle')}</Label>
              <Input id="pl-job" value={f.jobTitle} maxLength={150} onChange={(e) => set({ jobTitle: e.target.value })} />
            </div>
            {field('departureOn', t('international.placements.departure'))}
            {field('arrivedOn', t('international.placements.arrived'))}
            {field('contractStartOn', t('international.placements.contractStart'))}
            <div>
              <Label htmlFor="pl-months">{t('international.placements.contractMonths')}</Label>
              <Input id="pl-months" type="number" min={1} max={120} value={f.contractMonths} onChange={(e) => set({ contractMonths: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="pl-guarantee">{t('international.placements.guaranteeMonths')}</Label>
              <Input id="pl-guarantee" type="number" min={0} max={24} value={f.guaranteeMonths} onChange={(e) => set({ guaranteeMonths: e.target.value })} />
            </div>
            <div className="flex gap-2">
              <div className="flex-1">
                <Label htmlFor="pl-fee">{t('international.detail.fee')}</Label>
                <Input id="pl-fee" type="number" min={0} step="0.01" value={f.feeAmount} onChange={(e) => set({ feeAmount: e.target.value })} />
              </div>
              <div className="w-24">
                <Label htmlFor="pl-currency">{t('international.detail.currency')}</Label>
                <Select id="pl-currency" value={f.feeCurrency} onChange={(e) => set({ feeCurrency: e.target.value })}>
                  {CURRENCY_CODES.map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </Select>
              </div>
            </div>
            {(f.status === 'COMPLETED' || f.status === 'ENDED_EARLY') && field('endedOn', t('international.placements.endedOn'))}
            {f.status === 'ENDED_EARLY' && (
              <div className="sm:col-span-2">
                <Label htmlFor="pl-reason">{t('international.placements.endReason')}</Label>
                <Input id="pl-reason" value={f.endReason} maxLength={500} onChange={(e) => set({ endReason: e.target.value })} />
              </div>
            )}
          </div>
          {f.status === 'DEPLOYED' && !f.arrivedOn && <p className="text-xs text-ink/60">{t('international.placements.arrivalNeeded')}</p>}
          <div>
            <Label htmlFor="pl-note">{t('international.detail.note')}</Label>
            <Textarea id="pl-note" rows={3} maxLength={5000} value={f.staffNote} onChange={(e) => set({ staffNote: e.target.value })} />
          </div>
          {update.isError && <p className="text-sm text-danger">{update.error instanceof Error ? update.error.message : t('common.actionFailed')}</p>}
          <div className="flex items-center gap-3">
            <Button type="submit" disabled={update.isPending}>
              {t('common.save')}
            </Button>
            {saved && <span className="text-sm text-brand-dark">{t('international.detail.saved')}</span>}
          </div>
        </form>
      </CardContent>
    </Card>
  );
}

function toForm(p: StaffPlacement) {
  return {
    status: p.status,
    jobTitle: p.jobTitle ?? '',
    departureOn: p.departureOn ?? '',
    arrivedOn: p.arrivedOn ?? '',
    contractStartOn: p.contractStartOn ?? '',
    contractMonths: p.contractMonths == null ? '' : String(p.contractMonths),
    endedOn: p.endedOn ?? '',
    endReason: p.endReason ?? '',
    guaranteeMonths: String(p.guaranteeMonths),
    feeAmount: p.feeAmount == null ? '' : String(p.feeAmount),
    feeCurrency: p.feeCurrency ?? 'USD',
    staffNote: p.staffNote ?? '',
  };
}
