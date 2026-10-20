import { BadRequestException } from '@nestjs/common';
import { randomUUID as uuid } from 'crypto';
import { computeTotals, toCents, type BillingUnit, type DiscountType } from '@care-platform/shared';
import type { BillingLineDto } from './dto/billing.dto';
import type { BuiltLine } from './line-builder';

/** A line as stored (minus the parent id), for invoices and payouts alike. */
export interface StoredLine {
  id: string;
  position: number;
  kind: 'SHIFT' | 'ITEM' | 'ADJUSTMENT';
  description: string;
  serviceDate: string | null;
  quantity: string;
  unit: BillingUnit;
  unitPrice: string;
  discountType: DiscountType | null;
  discountValue: string | null;
  amount: string;
  shiftId: string | null;
  bookingId: string | null;
  caregiverId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  /** The billing adjustment this line carries (see billing_adjustments), if any. */
  adjustmentId?: string | null;
  taxable?: boolean;
}

/**
 * The editor sends the whole table back. Lines it already had keep their link
 * to the shift (or monthly period, or carried adjustment) they bill - the browser can change the
 * words and the price, never what a line is for. New lines are extras: an
 * ITEM (a charge or allowance) or an ADJUSTMENT (a credit or deduction, the
 * only kind that may be negative). Returns the lines in order with their
 * amounts worked out.
 */
export function normalizeLines(input: BillingLineDto[], existing: StoredLine[], withTax: boolean): StoredLine[] {
  const byId = new Map(existing.map((l) => [l.id, l]));
  const seen = new Set<string>();
  const lines = input.map((dto, i): StoredLine => {
    const prior = dto.id ? byId.get(dto.id) : undefined;
    if (dto.id && (!prior || seen.has(dto.id))) throw new BadRequestException('This line is not part of the document');
    if (dto.id) seen.add(dto.id);
    const kind = prior?.kind === 'SHIFT' ? 'SHIFT' : dto.kind;
    if (!prior && kind === 'SHIFT') throw new BadRequestException('Lines for shifts are added from the shifts themselves');
    if (prior && prior.kind !== 'SHIFT' && dto.kind === 'SHIFT') throw new BadRequestException('Lines for shifts are added from the shifts themselves');
    if (!dto.description?.trim()) throw new BadRequestException('Describe every line');
    if (toCents(dto.quantity) <= 0) throw new BadRequestException('The quantity must be more than zero');
    if (toCents(dto.unitPrice) < 0 && kind !== 'ADJUSTMENT') throw new BadRequestException('Only an adjustment can have a negative price');
    const discountType = dto.discountType && dto.discountValue && toCents(dto.discountValue) > 0 ? dto.discountType : null;
    if (discountType === 'PERCENT' && toCents(dto.discountValue!) > 10000) throw new BadRequestException('A discount cannot be more than 100%');
    return {
      id: prior?.id ?? uuid(),
      position: i,
      kind,
      description: dto.description.trim(),
      serviceDate: dto.serviceDate ?? null,
      quantity: dto.quantity,
      unit: dto.unit,
      unitPrice: dto.unitPrice,
      discountType,
      discountValue: discountType ? dto.discountValue! : null,
      amount: '0.00',
      shiftId: prior?.shiftId ?? null,
      bookingId: prior?.bookingId ?? null,
      caregiverId: prior?.caregiverId ?? null,
      periodStart: prior?.periodStart ?? null,
      periodEnd: prior?.periodEnd ?? null,
      adjustmentId: prior?.adjustmentId ?? null,
      ...(withTax ? { taxable: dto.taxable ?? prior?.taxable ?? true } : {}),
    };
  });
  return withAmounts(lines);
}

/** Fills each line's amount from computeTotals, so stored amounts and totals agree to the cent. */
export function withAmounts<T extends Omit<StoredLine, 'amount'> & { amount?: string }>(lines: T[]): (T & { amount: string })[] {
  const totals = computeTotals({ lines: lines.map((l) => ({ ...l, taxable: l.taxable })) });
  return lines.map((l, i) => ({ ...l, amount: totals.lines[i].amount }));
}

/** Generated lines -> stored lines, numbered on from `startAt`. */
export function fromBuilt(built: BuiltLine[], startAt: number): StoredLine[] {
  return withAmounts(
    built.map((b, i) => ({
      ...b,
      id: uuid(),
      position: startAt + i,
      discountType: null,
      discountValue: null,
      taxable: true,
    })),
  );
}
