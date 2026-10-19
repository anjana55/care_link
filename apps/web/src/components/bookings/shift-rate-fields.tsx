'use client';

import { useState } from 'react';
import Link from 'next/link';
import { Lock } from 'lucide-react';
import { formatLkr } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { useUpdateShift } from '@/lib/hooks/use-bookings';
import { Button } from '@/components/ui/button';
import { Input, Label, Select } from '@/components/ui/input';
import type { BookingDetail, BookingShift, RateType, ShiftRateInput, ShiftRateType } from '@/lib/api/types';

const MONEY = /^\d{1,8}(\.\d{1,2})?$/;
const SHIFT_RATE_TYPES: ShiftRateType[] = ['DAILY', 'HOURLY'];

/** Both sides of a shift's own rate as the form holds them: '' = the booking's rate. */
export interface ShiftRateValue {
  rateType: ShiftRateType | '';
  rateAmount: string;
  payRateType: ShiftRateType | '';
  payRateAmount: string;
}

export const emptyShiftRates: ShiftRateValue = { rateType: '', rateAmount: '', payRateType: '', payRateAmount: '' };

export const shiftRatesOf = (s: Pick<BookingShift, 'rateType' | 'rateAmount' | 'payRateType' | 'payRateAmount'>): ShiftRateValue => ({
  rateType: s.rateType ?? '',
  rateAmount: s.rateAmount ?? '',
  payRateType: s.payRateType ?? '',
  payRateAmount: s.payRateAmount ?? '',
});

export const shiftRatesValid = (v: ShiftRateValue) => (!v.rateType || MONEY.test(v.rateAmount.trim())) && (!v.payRateType || MONEY.test(v.payRateAmount.trim()));

/** The form value as an API payload. A locked side is left out entirely, so the API never sees a request for it. */
export function shiftRatesPayload(v: ShiftRateValue, locks: { client: boolean; pay: boolean }): ShiftRateInput {
  return {
    ...(locks.client ? {} : { rateType: v.rateType || null, rateAmount: v.rateType ? v.rateAmount.trim() : null }),
    ...(locks.pay ? {} : { payRateType: v.payRateType || null, payRateAmount: v.payRateType ? v.payRateAmount.trim() : null }),
  };
}

/** "LKR 5,000.00 per shift" - a shift's own rate. */
export function useShiftRateLabel() {
  const { t } = useTranslation();
  return (type: ShiftRateType | RateType, amount: string, unitKey: 'shiftRateUnit' | 'rateUnit' = 'shiftRateUnit') => `${formatLkr(amount)} ${t(`bookings.${unitKey}.${type}`)}`;
}

/**
 * The two sides of a shift's own rate - what the client is charged and what
 * the caregiver is paid - each either "the booking's rate" or a rate of its
 * own, by the hour or for the whole shift. A side folded into a monthly line
 * is shown locked with the reason, matching what the API enforces.
 */
export function ShiftRateFields({
  booking,
  value,
  onChange,
  locks,
  idPrefix,
}: {
  booking: BookingDetail;
  value: ShiftRateValue;
  onChange: (v: ShiftRateValue) => void;
  locks: { client: boolean; pay: boolean };
  idPrefix: string;
}) {
  const { t } = useTranslation();
  const label = useShiftRateLabel();
  const bookingRate = (type: RateType | null, amount: string | null) =>
    type && amount ? t('bookings.shiftRate.useBooking', { rate: label(type, amount, 'rateUnit') }) : t('bookings.shiftRate.useBookingNone');

  const side = (
    key: 'client' | 'pay',
    title: string,
    type: ShiftRateType | '',
    amount: string,
    set: (type: ShiftRateType | '', amount: string) => void,
    fallback: string,
    locked: boolean,
    lockedText: string,
  ) => (
    <fieldset className="min-w-0">
      <legend className="mb-1 text-xs font-medium text-ink/60">{title}</legend>
      {locked ? (
        <p className="flex items-start gap-1.5 rounded bg-ink/5 px-2 py-1.5 text-xs text-ink/60">
          <Lock size={12} className="mt-0.5 shrink-0" aria-hidden />
          {lockedText}
        </p>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_7rem] gap-2">
          <Select
            id={`${idPrefix}-${key}-type`}
            aria-label={title}
            value={type}
            onChange={(e) => set(e.target.value as ShiftRateType | '', e.target.value ? amount : '')}
          >
            <option value="">{fallback}</option>
            {SHIFT_RATE_TYPES.map((r) => (
              <option key={r} value={r}>
                {t(`bookings.shiftRate.${r}`)}
              </option>
            ))}
          </Select>
          <Input
            id={`${idPrefix}-${key}-amount`}
            inputMode="decimal"
            placeholder="0.00"
            disabled={!type}
            value={amount}
            onChange={(e) => set(type, e.target.value)}
            aria-label={t('bookings.shiftRate.amount')}
            aria-invalid={Boolean(type) && !MONEY.test(amount.trim())}
          />
        </div>
      )}
    </fieldset>
  );

  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {side(
        'client',
        t('bookings.detail.clientRate'),
        value.rateType,
        value.rateAmount,
        (rateType, rateAmount) => onChange({ ...value, rateType, rateAmount }),
        bookingRate(booking.rateType, booking.rateAmount),
        locks.client,
        t('bookings.shiftRate.clientLocked'),
      )}
      {side(
        'pay',
        t('bookings.detail.payRate'),
        value.payRateType,
        value.payRateAmount,
        (payRateType, payRateAmount) => onChange({ ...value, payRateType, payRateAmount }),
        bookingRate(booking.payRateType, booking.payRateAmount),
        locks.pay,
        t('bookings.shiftRate.payLocked'),
      )}
    </div>
  );
}

/** Inline editor for one shift's own rates, opened from its roster row. */
export function ShiftRateEditor({ booking, shift, onDone }: { booking: BookingDetail; shift: BookingShift; onDone: () => void }) {
  const { t } = useTranslation();
  const update = useUpdateShift(booking.id);
  const [value, setValue] = useState<ShiftRateValue>(() => shiftRatesOf(shift));
  const locks = { client: shift.clientRateLocked, pay: shift.payRateLocked };
  const valid = shiftRatesValid(value);
  const billedDocs = [
    shift.invoice ? (shift.invoice.number ? t('bookings.detail.onInvoice', { number: shift.invoice.number }) : t('bookings.detail.onInvoiceDraft')) : null,
    shift.payout ? t('bookings.detail.onPayout', { reference: shift.payout.reference }) : null,
  ].filter(Boolean);

  return (
    <div className="mt-2 rounded border border-border bg-paper p-3 sm:ml-32">
      <Label className="mb-2 block">{t('bookings.shiftRate.title')}</Label>
      <ShiftRateFields booking={booking} value={value} onChange={setValue} locks={locks} idPrefix={`rate-${shift.id}`} />
      {billedDocs.length > 0 && <p className="mt-2 text-xs text-accent">{t('bookings.shiftRate.billedHint', { docs: billedDocs.join(', ') })}</p>}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={!valid || update.isPending || (locks.client && locks.pay)} onClick={() => update.mutate({ shiftId: shift.id, ...shiftRatesPayload(value, locks) }, { onSuccess: onDone })}>
          {t('common.save')}
        </Button>
        <Button size="sm" variant="secondary" onClick={onDone}>
          {t('common.cancel')}
        </Button>
        {!valid && <span className="text-xs text-danger">{t('bookings.shiftRate.invalid')}</span>}
      </div>
      {update.isError && (
        <p role="alert" className="mt-2 text-xs text-danger">
          {update.error instanceof ApiError && update.error.message ? update.error.message : t('requests.detail.saveFailed')}
        </p>
      )}
    </div>
  );
}

/** Chips on a roster row: the shift's own rates, and the invoice / pay statement it's already on. */
export function ShiftRateChips({ shift }: { shift: BookingShift }) {
  const { t } = useTranslation();
  const label = useShiftRateLabel();
  const chips: { key: string; text: string; href?: string; tone: 'rate' | 'doc' }[] = [];
  if (shift.rateType && shift.rateAmount) chips.push({ key: 'c', text: t('bookings.detail.ownRateCharged', { rate: label(shift.rateType, shift.rateAmount) }), tone: 'rate' });
  if (shift.payRateType && shift.payRateAmount) chips.push({ key: 'p', text: t('bookings.detail.ownRatePaid', { rate: label(shift.payRateType, shift.payRateAmount) }), tone: 'rate' });
  if (shift.invoice)
    chips.push({
      key: 'i',
      text: shift.invoice.number ? t('bookings.detail.onInvoice', { number: shift.invoice.number }) : t('bookings.detail.onInvoiceDraft'),
      href: `/invoices/${shift.invoice.id}`,
      tone: 'doc',
    });
  if (shift.payout) chips.push({ key: 'o', text: t('bookings.detail.onPayout', { reference: shift.payout.reference }), href: `/payouts/${shift.payout.id}`, tone: 'doc' });
  if (!chips.length) return null;
  return (
    <div className="mt-1 flex flex-wrap gap-1.5 sm:pl-32">
      {chips.map((c) => {
        const cls =
          c.tone === 'rate'
            ? 'rounded bg-brand-light px-1.5 py-0.5 text-xs font-medium tabular-nums text-brand-dark'
            : 'rounded border border-border px-1.5 py-0.5 text-xs tabular-nums text-ink/60 hover:text-ink';
        return c.href ? (
          <Link key={c.key} href={c.href} className={cls}>
            {c.text}
          </Link>
        ) : (
          <span key={c.key} className={cls}>
            {c.text}
          </span>
        );
      })}
    </div>
  );
}
