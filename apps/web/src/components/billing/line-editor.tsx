'use client';

import { Plus, Trash2 } from 'lucide-react';
import { BILLING_UNITS, computeTotals, formatLkr, type Totals } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { fmtDate } from '@/lib/colombo-time';
import { Input, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import type { BillingLine, BillingLineInput, BillingLineKind, BillingUnit, DiscountType } from '@/lib/api/types';

/**
 * The editable table of lines shared by invoices and payout statements. The
 * parent owns the rows and saves them; this only edits. Every amount shown is
 * worked out with the same computeTotals the API stores, so what staff see
 * while typing is to the cent what the client will be billed.
 */

export interface EditableRow {
  key: string;
  id?: string;
  kind: BillingLineKind;
  description: string;
  serviceDate: string | null;
  quantity: string;
  unit: BillingUnit;
  unitPrice: string;
  discountType: DiscountType | null;
  discountValue: string;
  taxable: boolean;
  shiftId: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  bookingReference?: string | null;
}

const QUANTITY = /^\d{1,6}(\.\d{1,2})?$/;
const PRICE = /^-?\d{1,10}(\.\d{1,2})?$/;
const AMOUNT = /^\d{1,10}(\.\d{1,2})?$/;

let counter = 0;
const newKey = () => `new-${++counter}`;

export function rowsFrom(lines: (BillingLine & { bookingReference?: string | null })[]): EditableRow[] {
  return lines.map((l) => ({
    key: l.id,
    id: l.id,
    kind: l.kind,
    description: l.description,
    serviceDate: l.serviceDate,
    quantity: l.quantity,
    unit: l.unit,
    unitPrice: l.unitPrice,
    discountType: l.discountType,
    discountValue: l.discountValue ?? '',
    taxable: l.taxable ?? true,
    shiftId: l.shiftId,
    periodStart: l.periodStart,
    periodEnd: l.periodEnd,
    bookingReference: l.bookingReference ?? null,
  }));
}

export function newRow(kind: 'ITEM' | 'ADJUSTMENT'): EditableRow {
  return {
    key: newKey(),
    kind,
    description: '',
    serviceDate: null,
    quantity: '1',
    unit: 'ITEM',
    unitPrice: '',
    discountType: null,
    discountValue: '',
    taxable: true,
    shiftId: null,
    periodStart: null,
    periodEnd: null,
  };
}

/** What is wrong with a row, as a dictionary key - or null when it can be saved. */
export function rowProblem(r: EditableRow): string | null {
  if (!r.description.trim()) return 'billing.lines.needDescription';
  if (!QUANTITY.test(r.quantity.trim()) || Number(r.quantity) <= 0) return 'billing.lines.badQuantity';
  if (!PRICE.test(r.unitPrice.trim())) return 'billing.lines.badPrice';
  if (Number(r.unitPrice) < 0 && r.kind !== 'ADJUSTMENT') return 'billing.lines.negativeOnlyAdjustment';
  if (r.discountType && r.discountValue.trim() && !AMOUNT.test(r.discountValue.trim())) return 'billing.lines.badDiscount';
  if (r.discountType === 'PERCENT' && Number(r.discountValue) > 100) return 'billing.lines.discountOver100';
  return null;
}

export function toInput(rows: EditableRow[], withTax: boolean): BillingLineInput[] {
  return rows.map((r) => ({
    ...(r.id ? { id: r.id } : {}),
    kind: r.kind,
    description: r.description.trim(),
    serviceDate: r.serviceDate || null,
    quantity: r.quantity.trim(),
    unit: r.unit,
    unitPrice: r.unitPrice.trim(),
    discountType: r.discountType && r.discountValue.trim() ? r.discountType : null,
    discountValue: r.discountType && r.discountValue.trim() ? r.discountValue.trim() : null,
    ...(withTax ? { taxable: r.taxable } : {}),
  }));
}

/** Totals for the rows as typed; rows that are not valid yet count as zero. */
export function liveTotals(rows: EditableRow[], opts: { discountType?: DiscountType | null; discountValue?: string | null; taxRate?: string | null } = {}): Totals {
  const safe = rows.map((r) =>
    rowProblem(r)
      ? { quantity: '0', unitPrice: '0', taxable: r.taxable }
      : { quantity: r.quantity.trim(), unitPrice: r.unitPrice.trim(), discountType: r.discountType, discountValue: r.discountValue.trim() || null, taxable: r.taxable },
  );
  const dv = opts.discountValue && AMOUNT.test(opts.discountValue.trim()) ? opts.discountValue.trim() : null;
  return computeTotals({ lines: safe, discountType: dv ? opts.discountType : null, discountValue: dv, taxRate: opts.taxRate });
}

export function LineEditor({
  rows,
  onChange,
  mode,
  readOnly,
  withTax,
  totals,
  showProblems = false,
}: {
  rows: EditableRow[];
  onChange: (rows: EditableRow[]) => void;
  mode: 'invoice' | 'payout';
  readOnly: boolean;
  withTax: boolean;
  totals: Totals;
  /** Point out invalid rows - after a save was attempted, so a fresh blank row is not shouted at. */
  showProblems?: boolean;
}) {
  const { t, locale } = useTranslation();
  const set = (key: string, patch: Partial<EditableRow>) => onChange(rows.map((r) => (r.key === key ? { ...r, ...patch } : r)));

  return (
    <div>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[960px] text-left text-sm">
          <thead className="border-b border-border bg-paper text-xs uppercase tracking-wide text-ink/50">
            <tr>
              <th className="w-36 px-3 py-2 font-medium">{t('billing.lines.date')}</th>
              <th className="min-w-[16rem] px-3 py-2 font-medium">{t('billing.lines.description')}</th>
              <th className="w-20 px-3 py-2 text-right font-medium">{t('billing.lines.quantity')}</th>
              <th className="w-28 px-3 py-2 font-medium">{t('billing.lines.unit')}</th>
              <th className="w-28 px-3 py-2 text-right font-medium">{t('billing.lines.price')}</th>
              <th className="w-40 px-3 py-2 font-medium">{t('billing.lines.discount')}</th>
              {withTax && <th className="w-12 px-3 py-2 text-center font-medium">{t('billing.lines.taxable')}</th>}
              <th className="w-32 px-3 py-2 text-right font-medium">{t('billing.lines.amount')}</th>
              {!readOnly && <th className="w-10 px-1 py-2" />}
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-3 py-6 text-center text-ink/50">
                  {t('billing.lines.empty')}
                </td>
              </tr>
            )}
            {rows.map((r, i) => {
              const problem = readOnly || !showProblems ? null : rowProblem(r);
              const line = totals.lines[i];
              const unpriced = r.kind === 'SHIFT' && Number(r.unitPrice) === 0;
              return (
                <tr key={r.key} className={cn('align-top', problem && 'bg-danger-light/30', unpriced && !problem && 'bg-accent-light/40')}>
                  <td className="whitespace-nowrap px-3 py-2 text-ink/70">
                    {r.kind === 'SHIFT' || readOnly ? (
                      r.serviceDate ? (
                        fmtDate(r.serviceDate, locale)
                      ) : r.periodStart ? (
                        <span className="text-xs">
                          {fmtDate(r.periodStart, locale)} – {fmtDate(r.periodEnd!, locale)}
                        </span>
                      ) : (
                        '—'
                      )
                    ) : (
                      <Input type="date" className="h-8 w-32 px-2" value={r.serviceDate ?? ''} onChange={(e) => set(r.key, { serviceDate: e.target.value || null })} aria-label={t('billing.lines.date')} />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <div className="mb-1 flex items-center gap-2">
                      <span
                        className={cn(
                          'rounded px-1.5 text-[11px] font-medium uppercase tracking-wide',
                          r.kind === 'SHIFT' ? 'bg-paper text-ink/50' : r.kind === 'ITEM' ? 'bg-brand-light text-brand-dark' : 'bg-accent-light text-accent',
                        )}
                      >
                        {t(`billing.kind.${mode}.${r.kind}`)}
                      </span>
                      {r.bookingReference && <span className="text-xs tabular-nums text-ink/40">{r.bookingReference}</span>}
                    </div>
                    {readOnly ? (
                      <span className="text-ink">{r.description}</span>
                    ) : (
                      <Input className="h-8 px-2" maxLength={300} value={r.description} onChange={(e) => set(r.key, { description: e.target.value })} aria-label={t('billing.lines.description')} />
                    )}
                    {problem && <p className="mt-1 text-xs text-danger">{t(problem)}</p>}
                    {unpriced && !problem && <p className="mt-1 text-xs text-accent">{t('billing.lines.unpriced')}</p>}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {readOnly ? (
                      r.quantity
                    ) : (
                      <Input inputMode="decimal" className="h-8 px-2 text-right" value={r.quantity} onChange={(e) => set(r.key, { quantity: e.target.value })} aria-label={t('billing.lines.quantity')} />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {readOnly || r.kind === 'SHIFT' ? (
                      <span className="text-ink/70">{t(`billing.unit.${r.unit}`)}</span>
                    ) : (
                      <Select className="h-8 px-2" value={r.unit} onChange={(e) => set(r.key, { unit: e.target.value as BillingUnit })} aria-label={t('billing.lines.unit')}>
                        {BILLING_UNITS.map((u) => (
                          <option key={u} value={u}>
                            {t(`billing.unit.${u}`)}
                          </option>
                        ))}
                      </Select>
                    )}
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums">
                    {readOnly ? (
                      formatLkr(r.unitPrice).replace('LKR ', '')
                    ) : (
                      <Input
                        inputMode="decimal"
                        className="h-8 px-2 text-right"
                        placeholder={r.kind === 'ADJUSTMENT' ? '-500.00' : '0.00'}
                        value={r.unitPrice}
                        onChange={(e) => set(r.key, { unitPrice: e.target.value })}
                        aria-label={t('billing.lines.price')}
                      />
                    )}
                  </td>
                  <td className="px-3 py-2">
                    {readOnly ? (
                      line && Number(line.discount) > 0 ? (
                        <span className="text-ink/70">
                          −{formatLkr(line.discount).replace('LKR ', '')}
                          {r.discountType === 'PERCENT' && <span className="ml-1 text-xs text-ink/50">({Number(r.discountValue)}%)</span>}
                        </span>
                      ) : (
                        <span className="text-ink/30">—</span>
                      )
                    ) : (
                      <div className="flex gap-1">
                        <Select
                          className="h-8 w-16 px-1"
                          value={r.discountType ?? ''}
                          disabled={Number(r.unitPrice) < 0}
                          onChange={(e) => set(r.key, { discountType: (e.target.value || null) as DiscountType | null })}
                          aria-label={t('billing.lines.discountType')}
                        >
                          <option value="">—</option>
                          <option value="PERCENT">%</option>
                          <option value="AMOUNT">LKR</option>
                        </Select>
                        <Input
                          inputMode="decimal"
                          className="h-8 px-2 text-right"
                          disabled={!r.discountType}
                          value={r.discountValue}
                          onChange={(e) => set(r.key, { discountValue: e.target.value })}
                          aria-label={t('billing.lines.discount')}
                        />
                      </div>
                    )}
                  </td>
                  {withTax && (
                    <td className="px-3 py-2 text-center">
                      <input
                        type="checkbox"
                        className="h-4 w-4 accent-brand"
                        checked={r.taxable}
                        disabled={readOnly}
                        onChange={(e) => set(r.key, { taxable: e.target.checked })}
                        aria-label={t('billing.lines.taxable')}
                      />
                    </td>
                  )}
                  <td className={cn('px-3 py-2 text-right font-medium tabular-nums', line && Number(line.amount) < 0 ? 'text-accent' : 'text-ink')}>
                    {line ? formatLkr(line.amount).replace('LKR ', '') : '—'}
                  </td>
                  {!readOnly && (
                    <td className="px-1 py-2">
                      <button
                        type="button"
                        onClick={() => onChange(rows.filter((x) => x.key !== r.key))}
                        className="rounded p-1.5 text-ink/40 hover:bg-danger-light hover:text-danger"
                        aria-label={t('billing.lines.remove')}
                        title={t('billing.lines.remove')}
                      >
                        <Trash2 size={14} />
                      </button>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      {!readOnly && (
        <div className="flex flex-wrap gap-2 border-t border-border px-3 py-3">
          <Button size="sm" variant="secondary" onClick={() => onChange([...rows, newRow('ITEM')])}>
            <Plus size={14} aria-hidden />
            {t(`billing.lines.add.${mode}.ITEM`)}
          </Button>
          <Button size="sm" variant="secondary" onClick={() => onChange([...rows, newRow('ADJUSTMENT')])}>
            <Plus size={14} aria-hidden />
            {t(`billing.lines.add.${mode}.ADJUSTMENT`)}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Subtotal, discount, tax and total, right-aligned under a table or in a side card. */
export function TotalsBlock({
  totals,
  discountLabel,
  taxLabel,
  paid,
  balance,
}: {
  totals: Pick<Totals, 'subtotal' | 'discount' | 'tax' | 'total'>;
  discountLabel?: string | null;
  taxLabel?: string | null;
  paid?: string;
  balance?: string;
}) {
  const { t } = useTranslation();
  const row = (label: string, value: string, strong = false) => (
    <div className={cn('flex justify-between gap-6 py-1', strong && 'border-t border-border pt-2 text-base font-semibold text-ink')}>
      <dt className={strong ? '' : 'text-ink/60'}>{label}</dt>
      <dd className="whitespace-nowrap tabular-nums">{value}</dd>
    </div>
  );
  return (
    <dl className="ml-auto w-full max-w-sm text-sm">
      {row(t('billing.totals.subtotal'), formatLkr(totals.subtotal))}
      {Number(totals.discount) > 0 && row(discountLabel ? `${t('billing.totals.discount')} (${discountLabel})` : t('billing.totals.discount'), `−${formatLkr(totals.discount)}`)}
      {taxLabel && row(taxLabel, formatLkr(totals.tax))}
      {row(t('billing.totals.total'), formatLkr(totals.total), true)}
      {paid !== undefined && Number(paid) !== 0 && row(t('billing.totals.paid'), `−${formatLkr(paid)}`)}
      {balance !== undefined && Number(paid ?? 0) !== 0 && row(t('billing.totals.balance'), formatLkr(balance), true)}
    </dl>
  );
}
