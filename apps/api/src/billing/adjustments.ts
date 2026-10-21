import { randomUUID as uuid } from 'crypto';
import { and, eq, inArray, ne, type SQL } from 'drizzle-orm';
import { fromCents, toCents } from '@care-platform/shared';
import type { Database } from '../database/database.module';
import { billingAdjustments, invoiceLines, invoices, payoutLines, payoutStatements, type CareRequestLanguage } from '../database/schema';
import { withAmounts, type StoredLine } from './billing-lines';

type Tx = Database;
type AdjustmentRow = typeof billingAdjustments.$inferSelect;

/**
 * Billing adjustments on documents. An OPEN adjustment is "applied" while a
 * line on a live (not void) invoice or statement carries its id - the same
 * rule that keeps a shift from being billed twice - so voiding the document,
 * deleting the draft, or taking the line out puts it back in the queue.
 */

export interface AppliedRef {
  kind: 'INVOICE' | 'PAYOUT';
  id: string;
  label: string | null;
  status: string;
}

/** For each adjustment id, the live document it is on right now. */
export async function appliedAdjustments(db: Tx, ids: string[]): Promise<Map<string, AppliedRef>> {
  const out = new Map<string, AppliedRef>();
  if (!ids.length) return out;
  const [inv, pay] = await Promise.all([
    db
      .select({ adjustmentId: invoiceLines.adjustmentId, id: invoices.id, number: invoices.number, status: invoices.status })
      .from(invoiceLines)
      .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
      .where(and(inArray(invoiceLines.adjustmentId, ids), ne(invoices.status, 'VOID'))),
    db
      .select({ adjustmentId: payoutLines.adjustmentId, id: payoutStatements.id, reference: payoutStatements.reference, status: payoutStatements.status })
      .from(payoutLines)
      .innerJoin(payoutStatements, eq(payoutLines.statementId, payoutStatements.id))
      .where(and(inArray(payoutLines.adjustmentId, ids), ne(payoutStatements.status, 'VOID'))),
  ]);
  for (const r of inv) if (r.adjustmentId) out.set(r.adjustmentId, { kind: 'INVOICE', id: r.id, label: r.number, status: r.status });
  for (const r of pay) if (r.adjustmentId) out.set(r.adjustmentId, { kind: 'PAYOUT', id: r.id, label: r.reference, status: r.status });
  return out;
}

const TEXT: Record<CareRequestLanguage, { from: string; plain: string }> = {
  en: { from: 'Correction to {label}: {text}', plain: 'Correction: {text}' },
  si: { from: 'නිවැරදි කිරීම ({label}): {text}', plain: 'නිවැරදි කිරීම: {text}' },
  ta: { from: 'திருத்தம் ({label}): {text}', plain: 'திருத்தம்: {text}' },
};
const fill = (t: string, v: Record<string, string>) => t.replace(/\{(\w+)\}/g, (_, k: string) => v[k] ?? '');

/** The line an adjustment becomes: on an invoice in the client's language, on a statement language-neutral. */
export function adjustmentLine(a: AdjustmentRow, position: number, mode: 'INVOICE' | 'PAYOUT', language: CareRequestLanguage): StoredLine {
  const description =
    mode === 'INVOICE'
      ? fill(a.sourceLabel ? (TEXT[language] ?? TEXT.en).from : (TEXT[language] ?? TEXT.en).plain, { label: a.sourceLabel ?? '', text: a.description })
      : `Correction${a.sourceLabel ? ` · ${a.sourceLabel}` : ''}: ${a.description}`;
  return withAmounts([
    {
      id: uuid(),
      position,
      kind: 'ADJUSTMENT' as const,
      description: description.slice(0, 300),
      serviceDate: null,
      quantity: '1.00',
      unit: 'ITEM' as const,
      unitPrice: a.amount,
      discountType: null,
      discountValue: null,
      shiftId: null,
      bookingId: a.bookingId,
      caregiverId: a.caregiverId,
      periodStart: null,
      periodEnd: null,
      adjustmentId: a.id,
      // A statement is never taxed; on an invoice, only if the invoice it came from was.
      taxable: mode === 'INVOICE' ? a.taxable : true,
    },
  ])[0];
}

/**
 * Lines for every open adjustment waiting for this client (CLIENT) or
 * caregiver (CAREGIVER) and not on a live document yet. An invoice for one
 * booking takes only that booking's adjustments; one for the whole client
 * takes them all.
 *
 * A document never goes below zero this way: `baseCents` is what its other
 * lines already come to, amounts owed to the party are added first, and a
 * credit (or deduction) bigger than what is left is split - the part that
 * fits goes on this document, the rest stays open, as its own adjustment, for
 * the next one. Splitting writes to the database, so call this inside the
 * document's transaction.
 */
export async function openAdjustmentLines(
  db: Tx,
  opts: { side: 'CLIENT' | 'CAREGIVER'; partyId: string; bookingIds?: string[] | null; language: CareRequestLanguage; startAt: number; baseCents: number },
): Promise<StoredLine[]> {
  const conditions: SQL[] = [
    eq(billingAdjustments.side, opts.side),
    eq(billingAdjustments.status, 'OPEN'),
    opts.side === 'CLIENT' ? eq(billingAdjustments.patientId, opts.partyId) : eq(billingAdjustments.caregiverId, opts.partyId),
  ];
  if (opts.bookingIds) {
    if (!opts.bookingIds.length) return [];
    conditions.push(inArray(billingAdjustments.bookingId, opts.bookingIds));
  }
  const rows = await db.select().from(billingAdjustments).where(and(...conditions)).orderBy(billingAdjustments.createdAt);
  if (!rows.length) return [];
  const applied = await appliedAdjustments(
    db,
    rows.map((r) => r.id),
  );
  const waiting = rows.filter((r) => !applied.has(r.id));
  // What is owed to them first, so it makes room for credits; each kind in the order it arose.
  const ordered = [...waiting.filter((r) => toCents(r.amount) >= 0), ...waiting.filter((r) => toCents(r.amount) < 0)];

  let room = opts.baseCents;
  const taken: AdjustmentRow[] = [];
  for (const a of ordered) {
    const cents = toCents(a.amount);
    if (cents >= 0) {
      room += cents;
      taken.push(a);
      continue;
    }
    if (room <= 0) continue;
    if (-cents <= room) {
      room += cents;
      taken.push(a);
      continue;
    }
    // Too big for this document: what fits goes on it, the rest waits for the next.
    const remainder = cents + room;
    await db.update(billingAdjustments).set({ amount: fromCents(-room) }).where(eq(billingAdjustments.id, a.id));
    await db.insert(billingAdjustments).values({ ...a, id: uuid(), amount: fromCents(remainder), splitFromId: a.id, createdAt: undefined });
    taken.push({ ...a, amount: fromCents(-room) });
    room = 0;
  }
  return taken.map((r, i) => adjustmentLine(r, opts.startAt + i, opts.side === 'CLIENT' ? 'INVOICE' : 'PAYOUT', opts.language));
}
