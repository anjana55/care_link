'use client';

import { useMemo, useState } from 'react';
import Link from 'next/link';
import { AlertTriangle, Plus, X } from 'lucide-react';
import { formatLkr, isoToColomboLocal } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { useApplyCorrection, usePreviewCorrection } from '@/lib/hooks/use-bookings';
import { fmtDay, fmtTime } from '@/lib/colombo-time';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, Textarea } from '@/components/ui/input';
import { CaregiverPicker } from '@/components/requests/caregiver-picker';
import { emptyShiftRates, shiftRatesOf, shiftRatesPayload, shiftRatesValid, ShiftRateFields, type ShiftRateValue } from '@/components/bookings/shift-rate-fields';
import { cn } from '@/lib/utils';
import type { AmendBookingInput, AmendShiftStatus, AmendmentDocumentImpact, AmendmentPreview, BookingDetail, BookingShift } from '@/lib/api/types';

const MONEY = /^\d{1,8}(\.\d{1,2})?$/;
const errorText = (err: unknown, fallback: string) => (err instanceof ApiError && err.message ? err.message : fallback);

interface Person {
  id: string;
  fullName: string;
}

interface ShiftEdit {
  shiftId: string;
  start: string;
  end: string;
  /** '' = leave the status as it is. */
  status: AmendShiftStatus | '';
  caregiver: Person;
  picking: boolean;
  ownRate: boolean;
  rates: ShiftRateValue;
}

interface AddedShift {
  key: number;
  start: string;
  end: string;
  caregiver: Person;
  picking: boolean;
  ownRate: boolean;
  rates: ShiftRateValue;
}

/** Shifts a correction may touch: anything not a draft that has started, or that is already on an invoice or statement. */
const correctable = (s: BookingShift, now: number) => s.status !== 'DRAFT' && (new Date(s.startsAt).getTime() <= now || Boolean(s.invoice || s.payout));

/** Whether a datetime-local value (Colombo time) has started. */
const startedAt = (local: string, now: number) => {
  const iso = local ? `${local}:00+05:30` : '';
  return iso ? Date.parse(iso) <= now : false;
};

/**
 * Correcting work that already happened, or is already billed. Staff list
 * what was wrong - a shift's times, what happened, who worked it, its price,
 * a shift missed off the roster, or the agreed rate itself - preview what that
 * does to every invoice and pay statement, choose how an unpaid issued invoice
 * takes it, and apply. The preview and the apply run the same rules on the API.
 */
export function CorrectBookingPanel({ booking, onClose }: { booking: BookingDetail; onClose: () => void }) {
  const { t, locale } = useTranslation();
  const preview = usePreviewCorrection(booking.id);
  const apply = useApplyCorrection(booking.id);
  const [now] = useState(() => Date.now());
  const [reason, setReason] = useState('');
  const [rateWrong, setRateWrong] = useState(false);
  const [rateAmount, setRateAmount] = useState(booking.rateAmount ?? '');
  const [payRateAmount, setPayRateAmount] = useState(booking.payRateAmount ?? '');
  const [edits, setEdits] = useState<ShiftEdit[]>([]);
  const [added, setAdded] = useState<AddedShift[]>([]);
  const [choices, setChoices] = useState<Record<string, 'REPLACE' | 'CARRY'>>({});
  const [shown, setShown] = useState<{ key: string; data: AmendmentPreview } | null>(null);

  const booked: Person | null = booking.caregiver ? { id: booking.caregiver.id, fullName: booking.caregiver.fullName } : null;
  const candidates = booking.shifts.filter((s) => correctable(s, now) && !edits.some((e) => e.shiftId === s.id));
  const shiftById = useMemo(() => new Map(booking.shifts.map((s) => [s.id, s])), [booking.shifts]);
  const locksFor = (caregiverId: string) => ({ client: booking.rateType === 'MONTHLY', pay: booking.payRateType === 'MONTHLY' && caregiverId === booking.caregiver?.id });

  const pick = (id: string) => {
    const s = shiftById.get(id);
    if (!s) return;
    setEdits((list) => [
      ...list,
      {
        shiftId: s.id,
        start: isoToColomboLocal(s.startsAt),
        end: isoToColomboLocal(s.endsAt),
        status: '',
        caregiver: s.caregiver ? { id: s.caregiver.id, fullName: s.caregiver.fullName } : (booked ?? { id: '', fullName: '—' }),
        picking: false,
        ownRate: Boolean(s.rateType || s.payRateType),
        rates: shiftRatesOf(s),
      },
    ]);
  };
  const patchEdit = (id: string, v: Partial<ShiftEdit>) => setEdits((list) => list.map((e) => (e.shiftId === id ? { ...e, ...v } : e)));
  const patchAdded = (key: number, v: Partial<AddedShift>) => setAdded((list) => list.map((a) => (a.key === key ? { ...a, ...v } : a)));

  // The request, without the per-invoice choices - so changing a choice re-previews without counting as a new correction.
  const body = useMemo((): AmendBookingInput | null => {
    const shifts = edits.map((e) => {
      const s = shiftById.get(e.shiftId)!;
      const locks = locksFor(e.caregiver.id);
      const original = shiftRatesOf(s);
      const rates = e.ownRate ? e.rates : emptyShiftRates;
      const ratesChanged = JSON.stringify(rates) !== JSON.stringify(original);
      return {
        shiftId: e.shiftId,
        ...(e.start !== isoToColomboLocal(s.startsAt) ? { start: e.start } : {}),
        ...(e.end !== isoToColomboLocal(s.endsAt) ? { end: e.end } : {}),
        ...(e.status ? { status: e.status } : {}),
        ...(s.caregiver && e.caregiver.id !== s.caregiver.id ? { caregiverId: e.caregiver.id } : {}),
        ...(ratesChanged ? shiftRatesPayload(rates, locks) : {}),
      };
    });
    const addShifts = added.map((a) => ({
      start: a.start,
      end: a.end,
      ...(booked && a.caregiver.id !== booked.id ? { caregiverId: a.caregiver.id } : {}),
      ...(a.ownRate ? shiftRatesPayload(a.rates, locksFor(a.caregiver.id)) : {}),
    }));
    const input: AmendBookingInput = {
      reason: reason.trim(),
      ...(shifts.length ? { shifts } : {}),
      ...(addShifts.length ? { addShifts } : {}),
      ...(rateWrong && booking.rateType && rateAmount.trim() !== (booking.rateAmount ?? '') ? { rateAmount: rateAmount.trim() } : {}),
      ...(rateWrong && booking.payRateType && payRateAmount.trim() !== (booking.payRateAmount ?? '') ? { payRateAmount: payRateAmount.trim() } : {}),
    };
    return input;
    // locksFor and shiftById only read booking, which is in the deps through them.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [edits, added, reason, rateWrong, rateAmount, payRateAmount, booking]);

  const valid =
    reason.trim().length >= 3 &&
    (edits.length > 0 || added.length > 0 || Boolean(body?.rateAmount || body?.payRateAmount)) &&
    edits.every((e) => e.start && e.end && (!e.ownRate || shiftRatesValid(e.rates))) &&
    added.every((a) => a.start && a.end && (!a.ownRate || shiftRatesValid(a.rates))) &&
    (!rateWrong || ((!booking.rateType || MONEY.test(rateAmount.trim())) && (!booking.payRateType || MONEY.test(payRateAmount.trim()))));
  const key = JSON.stringify(body);
  const fresh = shown?.key === key;

  const runPreview = (actions = choices) => {
    if (!body) return;
    preview.mutate({ ...body, invoiceActions: actions }, { onSuccess: (data) => setShown({ key, data }) });
  };
  const choose = (id: string, choice: 'REPLACE' | 'CARRY') => {
    const next = { ...choices, [id]: choice };
    setChoices(next);
    runPreview(next);
  };

  const statusOptions = (start: string): AmendShiftStatus[] => (startedAt(start, now) ? ['COMPLETED', 'MISSED'] : ['SCHEDULED', 'CANCELLED']);
  const pickerRow = (person: Person, picking: boolean, set: (v: { caregiver?: Person; picking?: boolean }) => void) =>
    picking ? (
      <div className="sm:col-span-2">
        <CaregiverPicker autoFocus onPick={(c) => set({ caregiver: { id: c.id, fullName: c.fullName }, picking: false })} onCancel={() => set({ picking: false })} />
      </div>
    ) : (
      <p className="text-sm text-ink/70 sm:col-span-2">
        {t('bookings.correct.workedBy', { name: person.fullName })}{' '}
        <button type="button" className="text-xs text-brand-dark hover:underline" onClick={() => set({ picking: true })}>
          {t('bookings.correct.changeCaregiver')}
        </button>
      </p>
    );

  return (
    <section className="mb-6 rounded-lg border border-accent/40 bg-white p-4 shadow-sm" aria-labelledby="correct-title">
      <div className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h2 id="correct-title" className="text-base font-semibold text-ink">
            {t('bookings.correct.title')}
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-ink/60">{t('bookings.correct.intro')}</p>
        </div>
        <button type="button" onClick={onClose} className="rounded p-1 text-ink/50 hover:bg-paper hover:text-ink" aria-label={t('common.cancel')}>
          <X size={16} />
        </button>
      </div>

      <div className="space-y-4">
        <div>
          <Label htmlFor="correctReason" required>
            {t('bookings.correct.reason')}
          </Label>
          <Textarea id="correctReason" rows={2} maxLength={500} placeholder={t('bookings.correct.reasonPlaceholder')} value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>

        {/* Shifts */}
        <div className="space-y-3">
          {edits.map((e) => {
            const s = shiftById.get(e.shiftId)!;
            const locks = locksFor(e.caregiver.id);
            return (
              <fieldset key={e.shiftId} className="rounded border border-border p-3">
                <legend className="flex items-center gap-2 px-1 text-sm font-medium text-ink">
                  {fmtDay(s.startsAt, locale)} · {fmtTime(s.startsAt, locale)}–{fmtTime(s.endsAt, locale)} · {t(`bookings.shiftStatus.${s.status}`)}
                  <button type="button" onClick={() => setEdits((l) => l.filter((x) => x.shiftId !== e.shiftId))} className="rounded p-0.5 text-ink/40 hover:text-danger" aria-label={t('bookings.correct.remove')} title={t('bookings.correct.remove')}>
                    <X size={14} />
                  </button>
                </legend>
                <div className="grid gap-3 sm:grid-cols-[1fr_1fr_12rem]">
                  <div>
                    <Label htmlFor={`cs-${e.shiftId}`}>{t('bookings.new.startTime')}</Label>
                    <Input id={`cs-${e.shiftId}`} type="datetime-local" step={900} value={e.start} onChange={(ev) => patchEdit(e.shiftId, { start: ev.target.value, status: '' })} />
                  </div>
                  <div>
                    <Label htmlFor={`ce-${e.shiftId}`}>{t('bookings.new.endTime')}</Label>
                    <Input id={`ce-${e.shiftId}`} type="datetime-local" step={900} min={e.start} value={e.end} onChange={(ev) => patchEdit(e.shiftId, { end: ev.target.value })} />
                  </div>
                  <div>
                    <Label htmlFor={`cst-${e.shiftId}`}>{t('bookings.correct.whatHappened')}</Label>
                    <Select id={`cst-${e.shiftId}`} value={e.status} onChange={(ev) => patchEdit(e.shiftId, { status: ev.target.value as AmendShiftStatus | '' })}>
                      <option value="">{t('bookings.correct.statusKeep', { status: t(`bookings.shiftStatus.${s.status}`) })}</option>
                      {statusOptions(e.start)
                        .filter((st) => st !== s.status)
                        .map((st) => (
                          <option key={st} value={st}>
                            {t(`bookings.shiftStatus.${st}`)}
                          </option>
                        ))}
                    </Select>
                  </div>
                  {pickerRow(e.caregiver, e.picking, (v) => patchEdit(e.shiftId, v))}
                </div>
                <label className="mt-3 flex items-center gap-2 text-sm text-ink/70">
                  <input type="checkbox" checked={e.ownRate} onChange={(ev) => patchEdit(e.shiftId, { ownRate: ev.target.checked })} className="h-4 w-4 rounded border-border" />
                  {t('bookings.shiftRate.different')}
                </label>
                {e.ownRate && (
                  <div className="mt-2">
                    <ShiftRateFields booking={booking} value={e.rates} onChange={(rates) => patchEdit(e.shiftId, { rates })} locks={locks} idPrefix={`correct-${e.shiftId}`} />
                  </div>
                )}
              </fieldset>
            );
          })}

          {added.map((a) => (
            <fieldset key={a.key} className="rounded border border-dashed border-brand/50 p-3">
              <legend className="flex items-center gap-2 px-1 text-sm font-medium text-ink">
                {t('bookings.correct.missingShift')}
                <button type="button" onClick={() => setAdded((l) => l.filter((x) => x.key !== a.key))} className="rounded p-0.5 text-ink/40 hover:text-danger" aria-label={t('bookings.correct.remove')} title={t('bookings.correct.remove')}>
                  <X size={14} />
                </button>
              </legend>
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <Label htmlFor={`as-${a.key}`}>{t('bookings.new.startTime')}</Label>
                  <Input id={`as-${a.key}`} type="datetime-local" step={900} value={a.start} onChange={(ev) => patchAdded(a.key, { start: ev.target.value })} />
                </div>
                <div>
                  <Label htmlFor={`ae-${a.key}`}>{t('bookings.new.endTime')}</Label>
                  <Input id={`ae-${a.key}`} type="datetime-local" step={900} min={a.start} value={a.end} onChange={(ev) => patchAdded(a.key, { end: ev.target.value })} />
                </div>
                {pickerRow(a.caregiver, a.picking, (v) => patchAdded(a.key, v))}
              </div>
              <label className="mt-3 flex items-center gap-2 text-sm text-ink/70">
                <input type="checkbox" checked={a.ownRate} onChange={(ev) => patchAdded(a.key, { ownRate: ev.target.checked })} className="h-4 w-4 rounded border-border" />
                {t('bookings.shiftRate.different')}
              </label>
              {a.ownRate && (
                <div className="mt-2">
                  <ShiftRateFields booking={booking} value={a.rates} onChange={(rates) => patchAdded(a.key, { rates })} locks={locksFor(a.caregiver.id)} idPrefix={`add-${a.key}`} />
                </div>
              )}
              <p className="mt-2 text-xs text-ink/50">{t('bookings.correct.missingHint')}</p>
            </fieldset>
          ))}

          <div className="flex flex-wrap items-center gap-2">
            {candidates.length > 0 && (
              <Select className="w-auto min-w-64" value="" onChange={(e) => e.target.value && pick(e.target.value)} aria-label={t('bookings.correct.pickShift')}>
                <option value="">{t('bookings.correct.pickShift')}</option>
                {candidates.map((s) => (
                  <option key={s.id} value={s.id}>
                    {fmtDay(s.startsAt, locale)} · {fmtTime(s.startsAt, locale)}–{fmtTime(s.endsAt, locale)} · {t(`bookings.shiftStatus.${s.status}`)}
                    {s.isCover && s.caregiver ? ` · ${s.caregiver.fullName}` : ''}
                    {s.invoice?.number ? ` · ${s.invoice.number}` : ''}
                  </option>
                ))}
              </Select>
            )}
            {booked && (
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  const last = booking.shifts.filter((s) => new Date(s.startsAt).getTime() <= now).at(-1);
                  const base = last ? isoToColomboLocal(last.startsAt).slice(0, 10) : booking.startDate;
                  setAdded((l) => [
                    ...l,
                    { key: Date.now(), start: `${base}T${booking.shiftStartTime}`, end: `${base}T${booking.shiftEndTime}`, caregiver: booked, picking: false, ownRate: false, rates: emptyShiftRates },
                  ]);
                }}
              >
                <Plus size={14} aria-hidden />
                {t('bookings.correct.addMissing')}
              </Button>
            )}
          </div>
        </div>

        {/* The agreed rate */}
        {(booking.rateType || booking.payRateType) && (
          <div>
            <label className="flex items-center gap-2 text-sm text-ink/70">
              <input type="checkbox" checked={rateWrong} onChange={(e) => setRateWrong(e.target.checked)} className="h-4 w-4 rounded border-border" />
              {t('bookings.correct.rateWrong')}
            </label>
            {rateWrong && (
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                {booking.rateType && (
                  <div>
                    <Label htmlFor="correctRate">
                      {t('bookings.detail.clientRate')} ({t(`bookings.rateUnit.${booking.rateType}`)})
                    </Label>
                    <Input id="correctRate" inputMode="decimal" value={rateAmount} onChange={(e) => setRateAmount(e.target.value)} aria-invalid={!MONEY.test(rateAmount.trim())} />
                  </div>
                )}
                {booking.payRateType && (
                  <div>
                    <Label htmlFor="correctPayRate">
                      {t('bookings.detail.payRate')} ({t(`bookings.rateUnit.${booking.payRateType}`)})
                    </Label>
                    <Input id="correctPayRate" inputMode="decimal" value={payRateAmount} onChange={(e) => setPayRateAmount(e.target.value)} aria-invalid={!MONEY.test(payRateAmount.trim())} />
                  </div>
                )}
                <p className="text-xs text-ink/50 sm:col-span-2">{t('bookings.correct.rateHint')}</p>
              </div>
            )}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2 border-t border-border pt-4">
          <Button variant="secondary" disabled={!valid || preview.isPending} onClick={() => runPreview()}>
            {preview.isPending ? t('bookings.correct.previewing') : t('bookings.correct.preview')}
          </Button>
          <Button
            disabled={!valid || !fresh || apply.isPending || preview.isPending}
            onClick={() => body && apply.mutate({ ...body, invoiceActions: choices }, { onSuccess: onClose })}
            title={!fresh ? t('bookings.correct.previewFirst') : undefined}
          >
            {apply.isPending ? t('bookings.correct.applying') : t('bookings.correct.apply')}
          </Button>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          {shown && !fresh && <span className="text-xs text-accent">{t('bookings.correct.stale')}</span>}
        </div>
        {(preview.isError || apply.isError) && (
          <p role="alert" className="text-sm text-danger">
            {errorText(apply.error ?? preview.error, t('requests.detail.saveFailed'))}
          </p>
        )}

        {shown && <PreviewView preview={shown.data} choices={choices} onChoose={choose} dim={!fresh || preview.isPending} />}
      </div>
    </section>
  );
}

function PreviewView({
  preview,
  choices,
  onChoose,
  dim,
}: {
  preview: AmendmentPreview;
  choices: Record<string, 'REPLACE' | 'CARRY'>;
  onChoose: (id: string, choice: 'REPLACE' | 'CARRY') => void;
  dim: boolean;
}) {
  const { t, locale } = useTranslation();
  return (
    <div className={cn('space-y-4 rounded border border-border bg-paper p-3 transition-opacity', dim && 'opacity-60')} aria-live="polite">
      <div>
        <h3 className="mb-1 text-sm font-semibold text-ink">{t('bookings.correct.changesTitle')}</h3>
        <ul className="space-y-0.5 text-sm text-ink/80">
          {preview.changes.map((c, i) => (
            <li key={c.shiftId ?? `b${i}`}>
              {c.date ? <span className="font-medium">{fmtDay(`${c.date}T06:30:00.000Z`, locale)}: </span> : null}
              {c.changes.join('; ')}
            </li>
          ))}
        </ul>
      </div>

      <div>
        <h3 className="mb-1 text-sm font-semibold text-ink">{t('bookings.correct.documentsTitle')}</h3>
        {preview.documents.length === 0 ? (
          <p className="text-sm text-ink/60">{t('bookings.correct.noDocuments')}</p>
        ) : (
          <ul className="space-y-2">
            {preview.documents.map((d) => (
              <DocumentImpact key={d.id} doc={d} choice={choices[d.id]} onChoose={onChoose} />
            ))}
          </ul>
        )}
      </div>

      {preview.adjustments.length > 0 && (
        <div>
          <h3 className="mb-1 text-sm font-semibold text-ink">{t('bookings.correct.adjustmentsTitle')}</h3>
          <ul className="space-y-0.5 text-sm">
            {preview.adjustments.map((a, i) => (
              <li key={i} className="flex flex-wrap justify-between gap-2">
                <span className="text-ink/80">
                  {t(a.side === 'CLIENT' ? 'bookings.correct.adjustmentClient' : 'bookings.correct.adjustmentCaregiver', { name: a.partyName ?? '—' })}
                  <span className="ml-1 text-xs text-ink/50">{a.description}</span>
                </span>
                <span className={cn('tabular-nums font-medium', a.amount.startsWith('-') ? 'text-danger' : 'text-brand-dark')}>{formatLkr(a.amount)}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {(preview.unbilled.client.length > 0 || preview.unbilled.pay.length > 0) && (
        <div className="space-y-1 text-sm text-ink/70">
          <h3 className="text-sm font-semibold text-ink">{t('bookings.correct.unbilledTitle')}</h3>
          {preview.unbilled.client.length > 0 && <p>{t('bookings.correct.unbilledClient', { shifts: preview.unbilled.client.join(', ') })}</p>}
          {preview.unbilled.pay.length > 0 && <p>{t('bookings.correct.unbilledPay', { shifts: preview.unbilled.pay.join(', ') })}</p>}
        </div>
      )}

      {preview.warnings.length > 0 && (
        <ul className="space-y-1">
          {preview.warnings.map((w) => (
            <li key={w} className="flex items-start gap-1.5 text-sm text-accent">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" aria-hidden />
              {w}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DocumentImpact({ doc, choice, onChoose }: { doc: AmendmentDocumentImpact; choice?: 'REPLACE' | 'CARRY'; onChoose: (id: string, c: 'REPLACE' | 'CARRY') => void }) {
  const { t, locale } = useTranslation();
  const title =
    doc.kind === 'INVOICE' ? (doc.label ? t('bookings.correct.invoice', { label: doc.label }) : t('bookings.correct.draftInvoice')) : t('bookings.correct.payout', { label: doc.label ?? '' });
  const href = doc.kind === 'INVOICE' ? `/invoices/${doc.id}` : `/payouts/${doc.id}`;
  const status = doc.kind === 'INVOICE' ? t(`billing.invoiceStatus.${doc.status}`) : t(`billing.payoutStatus.${doc.status}`);
  const diff = Number(doc.difference);
  return (
    <li className="rounded border border-border bg-white p-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm">
          <Link href={href} className="font-medium text-brand-dark hover:underline">
            {title}
          </Link>
          <span className="ml-2 text-xs text-ink/50">
            {status}
            {doc.partyName ? ` · ${doc.partyName}` : ''}
          </span>
        </div>
        <div className="text-right text-sm tabular-nums">
          <span className="text-ink/50">{formatLkr(doc.before)} → </span>
          <span className="text-ink">{formatLkr(doc.after)}</span>
          <span className={cn('ml-2 font-medium', diff < 0 ? 'text-danger' : diff > 0 ? 'text-brand-dark' : 'text-ink/50')}>
            ({diff > 0 ? '+' : ''}
            {formatLkr(doc.difference)})
          </span>
        </div>
      </div>
      {doc.choices.length > 1 ? (
        <div className="mt-2 flex flex-wrap gap-3 text-sm" role="radiogroup" aria-label={title}>
          {(doc.choices as ('REPLACE' | 'CARRY')[]).map((c) => (
            <label key={c} className="flex items-center gap-1.5">
              <input type="radio" name={`choice-${doc.id}`} checked={(choice ?? doc.action) === c} onChange={() => onChoose(doc.id, c)} />
              {t(`bookings.correct.action.${c}`)}
            </label>
          ))}
        </div>
      ) : (
        <p className="mt-1 text-sm text-ink/70">{t(`bookings.correct.action.${doc.action}`)}</p>
      )}
      <ul className="mt-1 space-y-0.5 text-xs text-ink/60">
        {doc.lines.map((l) => (
          <li key={l.lineId} className="flex justify-between gap-2">
            <span className="truncate">
              {l.serviceDate ? `${fmtDay(`${l.serviceDate}T06:30:00.000Z`, locale)} · ` : ''}
              {l.description}
            </span>
            <span className="shrink-0 tabular-nums">
              {formatLkr(l.before)} → {l.after === null ? t('bookings.correct.lineRemoved') : formatLkr(l.after)}
            </span>
          </li>
        ))}
      </ul>
    </li>
  );
}
