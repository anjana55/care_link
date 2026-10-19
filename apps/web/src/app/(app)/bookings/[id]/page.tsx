'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { AlertTriangle, ChevronLeft, ExternalLink, Pencil, Plus, Trash2, UserRoundCog } from 'lucide-react';
import { formatLkr, isoToColomboLocal, toColombo } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { useAuth } from '@/lib/api/auth-context';
import { ApiError } from '@/lib/api/client';
import {
  useAddBookingNote,
  useAddShift,
  useBooking,
  useCancelBooking,
  useCompleteBooking,
  useConfirmBooking,
  useExtendBooking,
  useRemoveShift,
  useUpdateBooking,
  useUpdateShift,
} from '@/lib/hooks/use-bookings';
import { fmtDate, fmtDateTime, fmtDay, fmtTime, fmtWeekday } from '@/lib/colombo-time';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { PhoneLink } from '@/components/clients/contact-links';
import { CaregiverPicker } from '@/components/requests/caregiver-picker';
import { BookingStatusBadge, ShiftStatusBadge } from '@/components/bookings/booking-badges';
import { RelatedInvoices } from '@/components/billing/related-invoices';
import { cn } from '@/lib/utils';
import type { BookingDetail, BookingShift, RateType, ShiftStatus } from '@/lib/api/types';

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError && err.message ? err.message : fallback);

/**
 * One booking: who, the pattern, the agreed rate, and the shift roster. While
 * it is a DRAFT staff shape the roster freely; confirming schedules every shift
 * and tells the client and caregiver. Shifts can still be changed afterwards -
 * times, a cover caregiver, what happened - and every change is re-checked
 * against the caregiver's other shifts.
 */
export default function BookingPage() {
  const { t, locale } = useTranslation();
  const { id } = useParams<{ id: string }>();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { data: booking, isLoading, isError } = useBooking(id);

  useEffect(() => {
    if (!authLoading && user && user.role !== 'ADMIN' && user.role !== 'STAFF') router.replace('/dashboard');
  }, [authLoading, user, router]);

  if (authLoading || isLoading) return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;
  if (isError || !booking) {
    return (
      <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-sm text-ink/60">
        <span>{t('bookings.notFound')}</span>
        <Link href="/bookings" className="text-brand-dark hover:underline">
          {t('bookings.back')}
        </Link>
      </div>
    );
  }
  const open = booking.status === 'DRAFT' || booking.status === 'CONFIRMED';

  return (
    <div>
      <Link href="/bookings" className="mb-4 inline-flex items-center gap-1 text-sm text-ink/60 hover:text-ink">
        <ChevronLeft size={16} />
        {t('bookings.back')}
      </Link>

      <div className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="flex items-center gap-3 text-xl font-semibold tabular-nums text-ink">
            {booking.reference}
            <BookingStatusBadge status={booking.status} label={t(`bookings.status.${booking.status}`)} />
          </h1>
          <p className="mt-1 text-sm text-ink/60">
            {t(`bookings.scheduleType.${booking.scheduleType}`)} · {booking.daysOfWeek.map((d) => fmtWeekday(d, locale)).join(' ')} · {booking.shiftStartTime}–{booking.shiftEndTime}
            {booking.shiftEndTime <= booking.shiftStartTime && ` (${t('bookings.detail.nextDay')})`} · {fmtDate(booking.startDate, locale)} – {fmtDate(booking.endDate, locale)}
          </p>
          {booking.careRequest && (
            <p className="mt-1 text-sm text-ink/60">
              {t('bookings.detail.fromRequest')}{' '}
              <Link href={`/requests/${booking.careRequest.id}`} className="font-medium text-brand-dark hover:underline">
                {booking.careRequest.reference}
              </Link>
            </p>
          )}
        </div>
        <BookingActions booking={booking} />
      </div>

      {booking.status === 'DRAFT' && (
        <p className="mb-4 rounded border border-accent/30 bg-accent-light px-3 py-2 text-sm text-accent">{t('bookings.detail.draftBanner')}</p>
      )}
      {booking.status === 'CANCELLED' && booking.cancelReason && (
        <p className="mb-4 rounded bg-ink/5 px-3 py-2 text-sm text-ink/70">{t('bookings.detail.cancelledBecause', { reason: booking.cancelReason })}</p>
      )}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex items-center justify-between gap-2">
            <CardTitle>{t('bookings.table.client')}</CardTitle>
            {booking.client && (
              <Link href={`/clients/${booking.client.id}`} className="inline-flex items-center gap-1 text-xs text-brand-dark hover:underline">
                {t('requests.detail.openClient')}
                <ExternalLink size={12} />
              </Link>
            )}
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="font-semibold text-ink">{booking.client?.fullName}</p>
            {booking.client?.recipientName && <p className="text-ink/60">{t('requests.forRecipient', { name: booking.client.recipientName })}</p>}
            {booking.client?.phone && <PhoneLink phone={booking.client.phone} />}
            <p className="text-ink/60">{[booking.client?.careAddress, booking.client?.city, booking.client?.district].filter(Boolean).join(', ') || '—'}</p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="flex items-center justify-between gap-2">
            <CardTitle>{t('bookings.table.caregiver')}</CardTitle>
            {booking.caregiver && !booking.caregiver.deleted && (
              <Link href={`/caregivers/${booking.caregiver.id}`} className="inline-flex items-center gap-1 text-xs text-brand-dark hover:underline">
                {t('requests.detail.openCaregiver')}
                <ExternalLink size={12} />
              </Link>
            )}
          </CardHeader>
          <CardContent className="space-y-1 text-sm">
            <p className="font-semibold text-ink">{booking.caregiver?.fullName}</p>
            <p className="tabular-nums text-ink/60">{booking.caregiver?.registrationNumber}</p>
            {booking.caregiver?.primaryPhone && <PhoneLink phone={booking.caregiver.primaryPhone} whatsapp />}
          </CardContent>
        </Card>
        <RateCard booking={booking} editable={open} />
      </div>

      <Roster booking={booking} />

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <div className="space-y-4">
          {open && <AddShiftCard booking={booking} />}
          {booking.status !== 'DRAFT' && <RelatedInvoices bookingId={booking.id} />}
        </div>
        <BookingHistory booking={booking} />
      </div>
    </div>
  );
}

function BookingActions({ booking }: { booking: BookingDetail }) {
  const { t } = useTranslation();
  const confirm = useConfirmBooking(booking.id);
  const complete = useCompleteBooking(booking.id);
  const cancel = useCancelBooking(booking.id);
  const extend = useExtendBooking(booking.id);
  const [mode, setMode] = useState<'cancel' | 'extend' | null>(null);
  const [reason, setReason] = useState('');
  const [newEnd, setNewEnd] = useState('');
  const err = [confirm, complete, cancel, extend].find((m) => m.isError)?.error;

  if (booking.status === 'COMPLETED' || booking.status === 'CANCELLED') return null;
  return (
    <div className="flex max-w-md flex-col items-start gap-2 sm:items-end">
      <div className="flex flex-wrap gap-2">
        {booking.status === 'DRAFT' && (
          <Button
            disabled={confirm.isPending || booking.blockingConflicts > 0 || booking.shifts.length === 0}
            onClick={() => confirm.mutate(undefined)}
            title={booking.blockingConflicts > 0 ? t('bookings.detail.resolveFirst') : undefined}
          >
            {t('bookings.detail.confirm')}
          </Button>
        )}
        <Button variant="secondary" onClick={() => setMode(mode === 'extend' ? null : 'extend')}>
          {t('bookings.detail.extend')}
        </Button>
        {booking.status === 'CONFIRMED' && (
          <Button variant="secondary" disabled={complete.isPending} onClick={() => complete.mutate(undefined)}>
            {t('bookings.detail.complete')}
          </Button>
        )}
        <Button variant="secondary" onClick={() => setMode(mode === 'cancel' ? null : 'cancel')}>
          {t('bookings.detail.cancel')}
        </Button>
      </div>
      {booking.status === 'DRAFT' && <p className="text-xs text-ink/50">{t('bookings.detail.confirmHint')}</p>}
      {mode === 'extend' && (
        <div className="flex w-full items-end gap-2 rounded border border-border bg-paper p-2">
          <div className="flex-1">
            <Label htmlFor="newEnd">{t('bookings.detail.newEndDate')}</Label>
            <Input id="newEnd" type="date" min={booking.endDate} value={newEnd} onChange={(e) => setNewEnd(e.target.value)} />
          </div>
          <Button size="sm" disabled={!newEnd || extend.isPending} onClick={() => extend.mutate(newEnd, { onSuccess: () => setMode(null) })}>
            {t('bookings.detail.extend')}
          </Button>
        </div>
      )}
      {mode === 'cancel' && (
        <div className="w-full rounded border border-border bg-paper p-2">
          <Label htmlFor="cancelReason" required>
            {t('bookings.detail.cancelReason')}
          </Label>
          <Input id="cancelReason" value={reason} onChange={(e) => setReason(e.target.value)} />
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="danger" disabled={!reason.trim() || cancel.isPending} onClick={() => cancel.mutate(reason.trim(), { onSuccess: () => setMode(null) })}>
              {t('bookings.detail.cancelConfirm')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setMode(null)}>
              {t('common.cancel')}
            </Button>
          </div>
          <p className="mt-1 text-xs text-ink/50">{t('bookings.detail.cancelHint')}</p>
        </div>
      )}
      {err && (
        <p role="alert" className="text-sm text-danger">
          {errorText(err, t('requests.detail.saveFailed'))}
        </p>
      )}
    </div>
  );
}

function RateCard({ booking, editable }: { booking: BookingDetail; editable: boolean }) {
  const { t } = useTranslation();
  const update = useUpdateBooking(booking.id);
  const [editing, setEditing] = useState(false);
  const [rateType, setRateType] = useState<RateType | ''>(booking.rateType ?? '');
  const [rateAmount, setRateAmount] = useState(booking.rateAmount ?? '');
  const [payRateType, setPayRateType] = useState<RateType | ''>(booking.payRateType ?? '');
  const [payRateAmount, setPayRateAmount] = useState(booking.payRateAmount ?? '');
  const e = booking.estimate;
  const pay = booking.payEstimate;
  const margin = e.total && pay.total ? Number(e.total) - Number(pay.total) : null;
  const rate = (type: RateType | null, amount: string | null, none: string) => (type && amount ? `${formatLkr(amount)} ${t(`bookings.rateUnit.${type}`)}` : none);
  const picker = (id: string, value: RateType | '', set: (v: RateType | '') => void, amount: string, setAmount: (v: string) => void, none: string, label: string) => (
    <div className="grid grid-cols-2 gap-2">
      <Select id={id} value={value} onChange={(ev) => set(ev.target.value as RateType | '')} aria-label={label}>
        <option value="">{none}</option>
        {(['DAILY', 'MONTHLY', 'HOURLY'] as RateType[]).map((r) => (
          <option key={r} value={r}>
            {t(`bookings.rateType.${r}`)}
          </option>
        ))}
      </Select>
      <Input inputMode="decimal" disabled={!value} value={amount} onChange={(ev) => setAmount(ev.target.value)} aria-label={t('bookings.new.rateAmount')} />
    </div>
  );

  return (
    <Card>
      <CardHeader className="flex items-center justify-between gap-2">
        <CardTitle>{t('bookings.detail.moneyTitle')}</CardTitle>
        {editable && !editing && (
          <button type="button" onClick={() => setEditing(true)} className="text-xs text-brand-dark hover:underline">
            {t('common.edit')}
          </button>
        )}
      </CardHeader>
      <CardContent className="space-y-2 text-sm">
        {editing ? (
          <>
            <p className="text-xs font-medium text-ink/60">{t('bookings.new.rateTitle')}</p>
            {picker('rateTypeEdit', rateType, setRateType, rateAmount, setRateAmount, t('bookings.new.noRate'), t('bookings.new.rateType'))}
            <p className="text-xs font-medium text-ink/60">{t('bookings.new.payRateType')}</p>
            {picker('payRateTypeEdit', payRateType, setPayRateType, payRateAmount, setPayRateAmount, t('bookings.new.noPayRate'), t('bookings.new.payRateType'))}
            <div className="flex gap-2">
              <Button
                size="sm"
                disabled={update.isPending}
                onClick={() =>
                  update.mutate(
                    {
                      rateType: rateType || null,
                      rateAmount: rateType ? rateAmount : null,
                      payRateType: payRateType || null,
                      payRateAmount: payRateType ? payRateAmount : null,
                    },
                    { onSuccess: () => setEditing(false) },
                  )
                }
              >
                {t('common.save')}
              </Button>
              <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
                {t('common.cancel')}
              </Button>
            </div>
            {update.isError && <p className="text-xs text-danger">{errorText(update.error, t('requests.detail.saveFailed'))}</p>}
          </>
        ) : (
          <dl className="space-y-1">
            <div className="flex justify-between gap-3">
              <dt className="text-ink/60">{t('bookings.detail.clientRate')}</dt>
              <dd className="text-right text-ink">{rate(booking.rateType, booking.rateAmount, t('bookings.new.noRate'))}</dd>
            </div>
            <div className="flex justify-between gap-3">
              <dt className="text-ink/60">{t('bookings.detail.payRate')}</dt>
              <dd className="text-right text-ink">{rate(booking.payRateType, booking.payRateAmount, t('bookings.new.noPayRate'))}</dd>
            </div>
          </dl>
        )}
        <p className="text-ink/60">{t('bookings.detail.totals', { shifts: e.shifts, hours: e.hours })}</p>
        <dl className="space-y-1 border-t border-border pt-2">
          {e.total && (
            <div className="flex justify-between gap-3">
              <dt className="text-ink/60">{t('bookings.detail.estimateCharge')}</dt>
              <dd className="tabular-nums font-semibold text-ink">{formatLkr(e.total)}</dd>
            </div>
          )}
          {pay.total && (
            <div className="flex justify-between gap-3">
              <dt className="text-ink/60">{t('bookings.detail.estimatePay')}</dt>
              <dd className="tabular-nums text-ink">{formatLkr(pay.total)}</dd>
            </div>
          )}
          {margin !== null && (
            <div className="flex justify-between gap-3">
              <dt className="text-ink/60">{t('bookings.detail.estimateMargin')}</dt>
              <dd className={cn('tabular-nums font-medium', margin < 0 ? 'text-danger' : 'text-brand-dark')}>
                {formatLkr(margin.toFixed(2))}
                {Number(e.total) > 0 && <span className="ml-1 text-xs text-ink/50">({Math.round((margin / Number(e.total)) * 100)}%)</span>}
              </dd>
            </div>
          )}
        </dl>
        <p className="text-xs text-ink/40">{t('bookings.detail.estimateHint')}</p>
      </CardContent>
    </Card>
  );
}

/** Shifts grouped by Colombo week, each editable in place. */
function Roster({ booking }: { booking: BookingDetail }) {
  const { t } = useTranslation();
  const [showPast, setShowPast] = useState(false);
  const now = Date.now();
  const past = booking.shifts.filter((s) => new Date(s.endsAt).getTime() < now);
  const visible = showPast ? booking.shifts : booking.shifts.filter((s) => new Date(s.endsAt).getTime() >= now);
  const weeks = useMemo(() => {
    const groups: { key: string; shifts: BookingShift[] }[] = [];
    for (const s of visible) {
      const { date, weekday } = toColombo(s.startsAt);
      const monday = new Date(Date.parse(`${date}T00:00:00Z`) - (weekday - 1) * 86_400_000).toISOString().slice(0, 10);
      const g = groups.at(-1);
      if (g && g.key === monday) g.shifts.push(s);
      else groups.push({ key: monday, shifts: [s] });
    }
    return groups;
  }, [visible]);
  const { locale } = useTranslation();

  return (
    <Card className="mt-4">
      <CardHeader className="flex flex-wrap items-center justify-between gap-2">
        <CardTitle>
          {t('bookings.detail.roster')} <span className="font-normal text-ink/50">({booking.shifts.length})</span>
        </CardTitle>
        {past.length > 0 && (
          <button type="button" className="text-xs text-brand-dark hover:underline" onClick={() => setShowPast((v) => !v)}>
            {showPast ? t('bookings.detail.hidePast') : t('bookings.detail.showPast', { count: past.length })}
          </button>
        )}
      </CardHeader>
      <CardContent className="p-0">
        {booking.blockingConflicts > 0 && (
          <p className="mx-5 mt-4 flex items-start gap-2 rounded bg-danger-light px-3 py-2 text-sm text-danger" role="alert">
            <AlertTriangle size={16} className="mt-0.5 shrink-0" aria-hidden />
            {t('bookings.detail.conflictsBanner', { count: booking.blockingConflicts })}
          </p>
        )}
        {visible.length === 0 && <p className="px-5 py-6 text-sm text-ink/50">{t('bookings.detail.noUpcoming')}</p>}
        {weeks.map((w) => (
          <div key={w.key}>
            <p className="border-b border-t border-border bg-paper px-5 py-1.5 text-xs font-medium uppercase tracking-wide text-ink/50">
              {t('bookings.detail.weekOf', { date: fmtDate(w.key, locale) })}
            </p>
            <ul className="divide-y divide-border">
              {w.shifts.map((s) => (
                <ShiftRow key={s.id} booking={booking} shift={s} />
              ))}
            </ul>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function ShiftRow({ booking, shift }: { booking: BookingDetail; shift: BookingShift }) {
  const { t, locale } = useTranslation();
  const update = useUpdateShift(booking.id);
  const remove = useRemoveShift(booking.id);
  const [editing, setEditing] = useState(false);
  const [covering, setCovering] = useState(false);
  const [start, setStart] = useState(isoToColomboLocal(shift.startsAt));
  const [end, setEnd] = useState(isoToColomboLocal(shift.endsAt));
  const open = booking.status === 'DRAFT' || booking.status === 'CONFIRMED';
  const blocking = shift.conflicts.filter((c) => c.kind === 'BLOCKING');
  const nextDay = toColombo(shift.endsAt).date !== toColombo(shift.startsAt).date;

  useEffect(() => {
    setStart(isoToColomboLocal(shift.startsAt));
    setEnd(isoToColomboLocal(shift.endsAt));
  }, [shift.startsAt, shift.endsAt]);

  const save = (v: Parameters<typeof update.mutate>[0], done?: () => void) => update.mutate(v, { onSuccess: done });

  return (
    <li className={cn('px-5 py-3', blocking.length > 0 && 'bg-danger-light/40')}>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <div className="w-28 shrink-0 text-sm font-medium text-ink">{fmtDay(shift.startsAt, locale)}</div>
        {editing ? (
          <div className="flex flex-wrap items-center gap-2">
            <Input type="datetime-local" step={900} className="w-52" value={start} onChange={(e) => setStart(e.target.value)} aria-label={t('bookings.new.startTime')} />
            <span className="text-ink/40">→</span>
            <Input type="datetime-local" step={900} className="w-52" value={end} min={start} onChange={(e) => setEnd(e.target.value)} aria-label={t('bookings.new.endTime')} />
            <Button size="sm" disabled={update.isPending} onClick={() => save({ shiftId: shift.id, start, end }, () => setEditing(false))}>
              {t('common.save')}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setEditing(false)}>
              {t('common.cancel')}
            </Button>
          </div>
        ) : (
          <div className="w-40 shrink-0 text-sm tabular-nums text-ink">
            {fmtTime(shift.startsAt, locale)}–{fmtTime(shift.endsAt, locale)}
            {nextDay && <span className="text-ink/50"> +1</span>}
            <span className="ml-2 text-xs text-ink/50">{t('bookings.detail.hours', { hours: shift.hours })}</span>
          </div>
        )}
        {!editing && (
          <>
            <div className="min-w-0 flex-1 text-sm">
              {shift.isCover ? (
                <span className="inline-flex items-center gap-1 text-accent">
                  <UserRoundCog size={14} aria-hidden />
                  {t('bookings.detail.coveredBy', { name: shift.caregiver?.fullName ?? '—' })}
                </span>
              ) : (
                <span className="text-ink/60">{shift.caregiver?.fullName}</span>
              )}
              {shift.note && <span className="ml-2 text-xs text-ink/50">· {shift.note}</span>}
            </div>
            <ShiftStatusBadge status={shift.status} label={t(`bookings.shiftStatus.${shift.status}`)} />
            {open && (
              <div className="flex items-center gap-1">
                {shift.status !== 'CANCELLED' && shift.status !== 'MISSED' && (
                  <button type="button" onClick={() => setEditing(true)} className="rounded p-1.5 text-ink/50 hover:bg-paper hover:text-ink" aria-label={t('bookings.detail.editTimes')} title={t('bookings.detail.editTimes')}>
                    <Pencil size={14} />
                  </button>
                )}
                {shift.status !== 'CANCELLED' && (
                  <button type="button" onClick={() => setCovering((v) => !v)} className="rounded p-1.5 text-ink/50 hover:bg-paper hover:text-ink" aria-label={t('bookings.detail.cover')} title={t('bookings.detail.cover')}>
                    <UserRoundCog size={14} />
                  </button>
                )}
                {shift.allowedStatuses.length > 0 && (
                  <Select
                    className="h-8 w-36 py-0 text-xs"
                    value=""
                    aria-label={t('bookings.detail.setStatus')}
                    disabled={update.isPending}
                    onChange={(e) => e.target.value && save({ shiftId: shift.id, status: e.target.value as ShiftStatus })}
                  >
                    <option value="">{t('bookings.detail.setStatus')}</option>
                    {shift.allowedStatuses.map((st) => (
                      <option key={st} value={st}>
                        {t(`bookings.shiftAction.${st}`)}
                      </option>
                    ))}
                  </Select>
                )}
                {shift.status === 'DRAFT' && (
                  <button
                    type="button"
                    disabled={remove.isPending}
                    onClick={() => remove.mutate(shift.id)}
                    className="rounded p-1.5 text-ink/50 hover:bg-danger-light hover:text-danger"
                    aria-label={t('bookings.detail.removeShift')}
                    title={t('bookings.detail.removeShift')}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
              </div>
            )}
          </>
        )}
      </div>
      {shift.conflicts.length > 0 && (
        <p className={cn('mt-1 pl-0 text-xs sm:pl-32', blocking.length ? 'text-danger' : 'text-accent')}>
          <AlertTriangle size={12} className="mr-1 inline" aria-hidden />
          {t(blocking.length ? 'bookings.detail.conflictBlocking' : 'bookings.detail.conflictDraft', {
            refs: [...new Set(shift.conflicts.map((c) => c.withBookingReference))].join(', '),
          })}
        </p>
      )}
      {covering && (
        <div className="mt-2 sm:pl-32">
          <CaregiverPicker autoFocus onPick={(c) => save({ shiftId: shift.id, caregiverId: c.id }, () => setCovering(false))} onCancel={() => setCovering(false)} />
          {shift.isCover && booking.caregiver && (
            <button type="button" className="mt-1 text-xs text-brand-dark hover:underline" onClick={() => save({ shiftId: shift.id, caregiverId: booking.caregiver!.id }, () => setCovering(false))}>
              {t('bookings.detail.backToBooked', { name: booking.caregiver.fullName })}
            </button>
          )}
        </div>
      )}
      {update.isError && (
        <p role="alert" className="mt-1 text-xs text-danger sm:pl-32">
          {errorText(update.error, t('requests.detail.saveFailed'))}
        </p>
      )}
    </li>
  );
}

function AddShiftCard({ booking }: { booking: BookingDetail }) {
  const { t } = useTranslation();
  const add = useAddShift(booking.id);
  const last = booking.shifts.at(-1);
  const [start, setStart] = useState(last ? isoToColomboLocal(last.startsAt) : `${booking.startDate}T${booking.shiftStartTime}`);
  const [end, setEnd] = useState(last ? isoToColomboLocal(last.endsAt) : `${booking.startDate}T${booking.shiftEndTime}`);
  const [note, setNote] = useState('');

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('bookings.detail.addShift')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <Label htmlFor="addStart">{t('bookings.new.startTime')}</Label>
            <Input id="addStart" type="datetime-local" step={900} value={start} onChange={(e) => setStart(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="addEnd">{t('bookings.new.endTime')}</Label>
            <Input id="addEnd" type="datetime-local" step={900} value={end} min={start} onChange={(e) => setEnd(e.target.value)} />
          </div>
        </div>
        <Input placeholder={t('bookings.detail.shiftNote')} value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} aria-label={t('bookings.detail.shiftNote')} />
        <Button size="sm" variant="secondary" disabled={add.isPending || !start || !end} onClick={() => add.mutate({ start, end, ...(note.trim() ? { note: note.trim() } : {}) }, { onSuccess: () => setNote('') })}>
          <Plus size={14} aria-hidden />
          {t('bookings.detail.addShift')}
        </Button>
        <p className="text-xs text-ink/50">{booking.status === 'DRAFT' ? t('bookings.detail.addShiftDraftHint') : t('bookings.detail.addShiftHint')}</p>
        {add.isError && (
          <p role="alert" className="text-sm text-danger">
            {errorText(add.error, t('requests.detail.saveFailed'))}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function BookingHistory({ booking }: { booking: BookingDetail }) {
  const { t, locale } = useTranslation();
  const addNote = useAddBookingNote(booking.id);
  const [note, setNote] = useState('');
  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('requests.detail.history')}</CardTitle>
      </CardHeader>
      <CardContent>
        {booking.notes && <p className="mb-3 whitespace-pre-wrap rounded bg-paper px-3 py-2 text-sm text-ink/80">{booking.notes}</p>}
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
          {[...booking.events].reverse().map((e) => (
            <li key={e.id} className="border-l-2 border-border pl-3">
              <p className="text-sm text-ink">{t(`bookings.event.${e.type}`)}</p>
              {e.note && <p className="mt-0.5 whitespace-pre-wrap text-sm text-ink/70">{e.note}</p>}
              <p className="mt-0.5 text-xs text-ink/50">
                {fmtDateTime(e.createdAt, locale)}
                {e.actor && ` · ${t('requests.detail.by', { name: e.actor.fullName })}`}
              </p>
            </li>
          ))}
        </ol>
      </CardContent>
    </Card>
  );
}
