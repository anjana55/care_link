import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, desc, eq, sql, type SQL } from 'drizzle-orm';
import type { BillingAdjustmentView } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { billingAdjustments, caregivers, patients } from '../database/schema';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { appliedAdjustments } from './adjustments';

type Tx = Database;

/**
 * Billing adjustments as staff see and close them. They are created only by
 * booking corrections; after that they ride onto the next invoice or pay
 * statement on their own, or staff settle them outside the documents (a cash
 * refund, a bank transfer) or cancel them, with a note either way.
 */
@Injectable()
export class AdjustmentsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async list(filter: { bookingId?: string; patientId?: string; caregiverId?: string; openOnly?: boolean }, db: Tx = this.db): Promise<BillingAdjustmentView[]> {
    const conditions: SQL[] = [];
    if (filter.bookingId) conditions.push(eq(billingAdjustments.bookingId, filter.bookingId));
    if (filter.patientId) conditions.push(eq(billingAdjustments.patientId, filter.patientId));
    if (filter.caregiverId) conditions.push(eq(billingAdjustments.caregiverId, filter.caregiverId));
    if (filter.openOnly) conditions.push(eq(billingAdjustments.status, 'OPEN'));
    const rows = await db
      .select({ a: billingAdjustments, client: patients.fullName, caregiver: caregivers.fullName })
      .from(billingAdjustments)
      .leftJoin(patients, eq(billingAdjustments.patientId, patients.id))
      .leftJoin(caregivers, eq(billingAdjustments.caregiverId, caregivers.id))
      .where(conditions.length ? and(...conditions) : undefined)
      .orderBy(desc(billingAdjustments.createdAt))
      .limit(200);
    const applied = await appliedAdjustments(
      db,
      rows.map((r) => r.a.id),
    );
    return rows.map(({ a, client, caregiver }) => {
      const on = applied.get(a.id) ?? null;
      return {
        id: a.id,
        side: a.side,
        partyName: (a.side === 'CLIENT' ? client : caregiver) ?? null,
        bookingId: a.bookingId,
        amount: a.amount,
        description: a.description,
        sourceLabel: a.sourceLabel,
        status: a.status === 'OPEN' && on ? 'APPLIED' : a.status,
        appliedTo: a.status === 'OPEN' ? on : null,
        closedNote: a.closedNote,
        closedAt: a.closedAt ? new Date(a.closedAt).toISOString() : null,
        createdAt: new Date(a.createdAt).toISOString(),
      };
    });
  }

  /** SETTLED (dealt with outside the documents) or CANCELLED (dropped). Only while open and on no document. */
  async close(id: string, outcome: 'SETTLED' | 'CANCELLED', note: string, actor: AuthenticatedUser) {
    if (!note?.trim()) throw new BadRequestException(outcome === 'SETTLED' ? 'Say how it was settled' : 'Give a reason');
    let bookingId = '';
    await this.db.transaction(async (tx) => {
      const t = tx as unknown as Tx;
      await t.execute(sql`SELECT id FROM billing_adjustments WHERE id = ${id} FOR UPDATE`);
      const [a] = await t.select().from(billingAdjustments).where(eq(billingAdjustments.id, id)).limit(1);
      if (!a) throw new NotFoundException('Adjustment not found');
      if (a.status !== 'OPEN') throw new BadRequestException('This adjustment is already closed');
      const on = (await appliedAdjustments(t, [id])).get(id);
      if (on) {
        const doc = on.kind === 'INVOICE' ? (on.label ? `invoice ${on.label}` : 'a draft invoice') : `pay statement ${on.label}`;
        throw new ConflictException(`This adjustment is on ${doc} - take the line off it first`);
      }
      await t
        .update(billingAdjustments)
        .set({ status: outcome, closedNote: note.trim(), closedAt: new Date(), closedByUserId: actor.userId })
        .where(eq(billingAdjustments.id, id));
      bookingId = a.bookingId;
    });
    return (await this.list({ bookingId })).find((a) => a.id === id)!;
  }
}
