import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt, randomUUID as uuid } from 'crypto';
import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, like, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import { addDays, colomboToUtc, colomboToday, computeTotals, daysInclusive, isValidDate, type CaregiverPayout } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { bookings, bookingShifts, caregivers, payoutLines, payoutStatements, users } from '../database/schema';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { BillingNotifier } from './billing-notifier.service';
import { buildLines, type BilledPeriod } from './line-builder';
import { fromBuilt, normalizeLines, type StoredLine } from './billing-lines';
import { CreatePayoutDto, GeneratePayoutsDto, PayPayoutDto, PayoutQueryDto, ReplaceLinesDto, UpdatePayoutDto } from './dto/billing.dto';
import { MAX_INVOICE_DAYS } from './invoices.service';

type Tx = Database;
type Row = typeof payoutStatements.$inferSelect;

const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
function payoutReference(): string {
  let out = 'PS-';
  for (let i = 0; i < 6; i++) out += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return out;
}

const isDuplicate = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e.code ?? e.cause?.code) === 'ER_DUP_ENTRY';
};

/**
 * What CareLink owes each caregiver. A statement covers one caregiver and one
 * period: a line for every shift they completed in it - as the booked
 * caregiver or as a cover - priced at the booking's pay rate, plus whatever
 * allowances (ITEM) or deductions (negative ADJUSTMENT) staff add.
 *
 * Like invoices, a shift is paid at most once: a shift on any statement that
 * is not VOID is left off every new one.
 */
@Injectable()
export class PayoutsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly notifier: BillingNotifier,
  ) {}

  async findAll(query: PayoutQueryDto) {
    const conditions: SQL[] = [];
    if (query.status) conditions.push(eq(payoutStatements.status, query.status));
    if (query.caregiverId) conditions.push(eq(payoutStatements.caregiverId, query.caregiverId));
    if (query.search?.trim()) {
      const term = `%${query.search.trim()}%`;
      conditions.push(or(like(payoutStatements.reference, term), like(caregivers.fullName, term), like(caregivers.registrationNumber, term))!);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const [{ total }] = await this.db.select({ total: count() }).from(payoutStatements).innerJoin(caregivers, eq(payoutStatements.caregiverId, caregivers.id)).where(where);
    const rows = await this.db
      .select({
        id: payoutStatements.id,
        reference: payoutStatements.reference,
        status: payoutStatements.status,
        periodStart: payoutStatements.periodStart,
        periodEnd: payoutStatements.periodEnd,
        total: payoutStatements.total,
        paidOn: payoutStatements.paidOn,
        caregiverId: caregivers.id,
        caregiverName: caregivers.fullName,
        caregiverRegistrationNumber: caregivers.registrationNumber,
        createdAt: payoutStatements.createdAt,
      })
      .from(payoutStatements)
      .innerJoin(caregivers, eq(payoutStatements.caregiverId, caregivers.id))
      .where(where)
      .orderBy(sql`FIELD(${payoutStatements.status}, 'DRAFT', 'APPROVED', 'PAID', 'VOID')`, desc(payoutStatements.periodEnd), asc(caregivers.fullName))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    return { items: rows, page: query.page, pageSize: query.pageSize, total, totalPages: Math.ceil(total / query.pageSize) };
  }

  async summary() {
    const rows = await this.db
      .select({ status: payoutStatements.status, n: count(), sum: sql<string>`COALESCE(SUM(${payoutStatements.total}), 0)` })
      .from(payoutStatements)
      .groupBy(payoutStatements.status);
    const byStatus = { DRAFT: 0, APPROVED: 0, PAID: 0, VOID: 0 };
    let toPay = 0;
    for (const r of rows) {
      byStatus[r.status] = r.n;
      if (r.status === 'APPROVED') toPay = Number(r.sum);
    }
    return { byStatus, approvedTotal: toPay.toFixed(2) };
  }

  private async statementOrThrow(id: string, db: Tx = this.db, lock = false): Promise<Row> {
    if (lock) await db.execute(sql`SELECT id FROM payout_statements WHERE id = ${id} FOR UPDATE`);
    const [row] = await db.select().from(payoutStatements).where(eq(payoutStatements.id, id)).limit(1);
    if (!row) throw new NotFoundException('Payout statement not found');
    return row;
  }

  private async draftOrThrow(id: string, db: Tx, lock = false) {
    const row = await this.statementOrThrow(id, db, lock);
    if (row.status !== 'DRAFT') throw new BadRequestException('Only a draft statement can be changed - send it back to draft first');
    return row;
  }

  async findOne(id: string) {
    const p = await this.statementOrThrow(id);
    const [lines, [cg]] = await Promise.all([
      this.db
        .select({ line: payoutLines, bookingReference: bookings.reference })
        .from(payoutLines)
        .leftJoin(bookings, eq(payoutLines.bookingId, bookings.id))
        .where(eq(payoutLines.statementId, id))
        .orderBy(asc(payoutLines.position)),
      this.db
        .select({ id: caregivers.id, fullName: caregivers.fullName, registrationNumber: caregivers.registrationNumber, primaryPhone: caregivers.primaryPhone })
        .from(caregivers)
        .where(eq(caregivers.id, p.caregiverId))
        .limit(1),
    ]);
    const names = new Map<string, { id: string; fullName: string }>();
    const ids = [p.createdByUserId, p.approvedByUserId, p.paidByUserId].filter((v): v is string => Boolean(v));
    if (ids.length) for (const u of await this.db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, ids))) names.set(u.id, u);
    const totals = computeTotals({ lines: lines.map((l) => ({ ...l.line, taxable: false })) });
    return {
      ...p,
      caregiver: cg ?? null,
      lines: lines.map((l, i) => ({ ...l.line, bookingReference: l.bookingReference, gross: totals.lines[i].gross, discount: totals.lines[i].discount })),
      unpricedLines: lines.filter((l) => l.line.kind === 'SHIFT' && Number(l.line.unitPrice) === 0).length,
      createdBy: p.createdByUserId ? (names.get(p.createdByUserId) ?? null) : null,
      approvedBy: p.approvedByUserId ? (names.get(p.approvedByUserId) ?? null) : null,
      paidBy: p.paidByUserId ? (names.get(p.paidByUserId) ?? null) : null,
    };
  }

  private validatePeriod(from: string, to: string) {
    if (!isValidDate(from) || !isValidDate(to)) throw new BadRequestException('Enter valid start and end dates');
    if (to < from) throw new BadRequestException('The end date must be on or after the start date');
    if (daysInclusive(from, to) > MAX_INVOICE_DAYS) throw new BadRequestException('One statement can cover at most a year');
  }

  /** The caregiver's completed, not-yet-paid shifts in the period, as lines. */
  private async linesFor(db: Tx, caregiverId: string, from: string, to: string, startAt: number) {
    const shifts = await db
      .select({
        id: bookingShifts.id,
        bookingId: bookingShifts.bookingId,
        caregiverId: bookingShifts.caregiverId,
        startsAt: bookingShifts.startsAt,
        endsAt: bookingShifts.endsAt,
        status: bookingShifts.status,
        // The shift's own pay rate, when it has one.
        rateType: bookingShifts.payRateType,
        rateAmount: bookingShifts.payRateAmount,
      })
      .from(bookingShifts)
      .where(
        and(
          eq(bookingShifts.caregiverId, caregiverId),
          eq(bookingShifts.status, 'COMPLETED'),
          gte(bookingShifts.startsAt, colomboToUtc(from, '00:00')),
          lt(bookingShifts.startsAt, colomboToUtc(addDays(to, 1), '00:00')),
        ),
      );
    if (!shifts.length) return { lines: [] as StoredLine[], skipped: 0, unpriced: 0 };
    const bookingIds = [...new Set(shifts.map((s) => s.bookingId))];
    const bookingRows = await db
      .select({
        id: bookings.id,
        reference: bookings.reference,
        caregiverId: bookings.caregiverId,
        startDate: bookings.startDate,
        endDate: bookings.endDate,
        // A payout prices from the pay rate, not what the client is charged.
        rateType: bookings.payRateType,
        rateAmount: bookings.payRateAmount,
      })
      .from(bookings)
      .where(inArray(bookings.id, bookingIds));

    const paidShifts = new Set(
      (
        await db
          .select({ shiftId: payoutLines.shiftId })
          .from(payoutLines)
          .innerJoin(payoutStatements, eq(payoutLines.statementId, payoutStatements.id))
          .where(and(inArray(payoutLines.shiftId, shifts.map((s) => s.id)), ne(payoutStatements.status, 'VOID')))
      ).map((r) => r.shiftId!),
    );
    const paidPeriods: BilledPeriod[] = (
      await db
        .select({ bookingId: payoutLines.bookingId, periodStart: payoutLines.periodStart, periodEnd: payoutLines.periodEnd })
        .from(payoutLines)
        .innerJoin(payoutStatements, eq(payoutLines.statementId, payoutStatements.id))
        .where(
          and(
            inArray(payoutLines.bookingId, bookingIds),
            eq(payoutLines.caregiverId, caregiverId),
            isNotNull(payoutLines.periodStart),
            ne(payoutStatements.status, 'VOID'),
          ),
        )
    ).map((r) => ({ bookingId: r.bookingId!, periodStart: r.periodStart!, periodEnd: r.periodEnd! }));

    const built = buildLines({
      mode: 'PAYOUT',
      language: 'en',
      from,
      to,
      statuses: ['COMPLETED'],
      caregiverId,
      bookings: bookingRows,
      shifts: shifts.map((s) => ({ ...s, startsAt: new Date(s.startsAt), endsAt: new Date(s.endsAt) })),
      billedShiftIds: paidShifts,
      billedPeriods: paidPeriods,
    });
    return { lines: fromBuilt(built.lines, startAt), skipped: built.skipped, unpriced: built.unpriced };
  }

  private async insertLines(db: Tx, statementId: string, lines: StoredLine[]) {
    for (let i = 0; i < lines.length; i += 200) {
      await db.insert(payoutLines).values(lines.slice(i, i + 200).map(({ taxable: _taxable, ...l }) => ({ ...l, statementId })));
    }
  }

  private async recalc(db: Tx, id: string) {
    const lines = await db.select().from(payoutLines).where(eq(payoutLines.statementId, id));
    const totals = computeTotals({ lines: lines.map((l) => ({ ...l, taxable: false })) });
    await db.update(payoutStatements).set({ total: totals.total, updatedAt: new Date() }).where(eq(payoutStatements.id, id));
  }

  private async insertStatement(db: Tx, values: Omit<typeof payoutStatements.$inferInsert, 'reference'>) {
    for (let attempt = 0; ; attempt++) {
      try {
        await db.insert(payoutStatements).values({ ...values, reference: payoutReference() });
        return;
      } catch (err) {
        if (isDuplicate(err) && attempt < 3) continue;
        throw err;
      }
    }
  }

  async create(dto: CreatePayoutDto, actor: AuthenticatedUser) {
    this.validatePeriod(dto.periodStart, dto.periodEnd);
    const [cg] = await this.db.select({ id: caregivers.id }).from(caregivers).where(and(eq(caregivers.id, dto.caregiverId), isNull(caregivers.deletedAt))).limit(1);
    if (!cg) throw new NotFoundException('Caregiver not found');
    const id = uuid();
    let generated = { added: 0, skipped: 0, unpriced: 0 };
    await this.db.transaction(async (tx) => {
      const t = tx as unknown as Tx;
      const built = await this.linesFor(t, dto.caregiverId, dto.periodStart, dto.periodEnd, 0);
      generated = { added: built.lines.length, skipped: built.skipped, unpriced: built.unpriced };
      await this.insertStatement(t, { id, caregiverId: dto.caregiverId, periodStart: dto.periodStart, periodEnd: dto.periodEnd, createdByUserId: actor.userId });
      await this.insertLines(t, id, built.lines);
      await this.recalc(t, id);
    });
    return { ...(await this.findOne(id)), generated };
  }

  /**
   * Pay run: a draft statement for every caregiver who completed a shift in
   * the period that is not on a statement yet. Caregivers with nothing new are
   * left alone, so running it twice makes nothing twice.
   */
  async generate(dto: GeneratePayoutsDto, actor: AuthenticatedUser) {
    this.validatePeriod(dto.periodStart, dto.periodEnd);
    const workers = await this.db
      .selectDistinct({ caregiverId: bookingShifts.caregiverId })
      .from(bookingShifts)
      .where(
        and(
          eq(bookingShifts.status, 'COMPLETED'),
          gte(bookingShifts.startsAt, colomboToUtc(dto.periodStart, '00:00')),
          lt(bookingShifts.startsAt, colomboToUtc(addDays(dto.periodEnd, 1), '00:00')),
        ),
      );
    const created: string[] = [];
    for (const { caregiverId } of workers) {
      await this.db.transaction(async (tx) => {
        const t = tx as unknown as Tx;
        // One pay run at a time per caregiver: the caregiver row is the lock.
        await t.execute(sql`SELECT id FROM caregivers WHERE id = ${caregiverId} FOR UPDATE`);
        const built = await this.linesFor(t, caregiverId, dto.periodStart, dto.periodEnd, 0);
        if (!built.lines.length) return;
        const id = uuid();
        await this.insertStatement(t, { id, caregiverId, periodStart: dto.periodStart, periodEnd: dto.periodEnd, createdByUserId: actor.userId });
        await this.insertLines(t, id, built.lines);
        await this.recalc(t, id);
        created.push(id);
      });
    }
    return { created: created.length, ids: created };
  }

  async update(id: string, dto: UpdatePayoutDto) {
    await this.db.transaction(async (tx) => {
      const p = await this.statementOrThrow(id, tx as unknown as Tx, true);
      if (p.status === 'VOID') throw new BadRequestException('This statement is void');
      await tx.update(payoutStatements).set({ notes: dto.notes?.trim() || null, updatedAt: new Date() }).where(eq(payoutStatements.id, id));
    });
    return this.findOne(id);
  }

  async replaceLines(id: string, dto: ReplaceLinesDto) {
    await this.db.transaction(async (tx) => {
      const t = tx as unknown as Tx;
      await this.draftOrThrow(id, t, true);
      const existing = (await tx.select().from(payoutLines).where(eq(payoutLines.statementId, id))) as StoredLine[];
      const next = normalizeLines(dto.lines, existing, false);
      await tx.delete(payoutLines).where(eq(payoutLines.statementId, id));
      await this.insertLines(t, id, next);
      await this.recalc(t, id);
    });
    return this.findOne(id);
  }

  async addShiftLines(id: string) {
    let generated = { added: 0, skipped: 0, unpriced: 0 };
    await this.db.transaction(async (tx) => {
      const t = tx as unknown as Tx;
      const p = await this.draftOrThrow(id, t, true);
      const [{ maxPos }] = await tx.select({ maxPos: sql<number>`COALESCE(MAX(${payoutLines.position}), -1)` }).from(payoutLines).where(eq(payoutLines.statementId, id));
      const built = await this.linesFor(t, p.caregiverId, p.periodStart, p.periodEnd, Number(maxPos) + 1);
      generated = { added: built.lines.length, skipped: built.skipped, unpriced: built.unpriced };
      await this.insertLines(t, id, built.lines);
      await this.recalc(t, id);
    });
    return { ...(await this.findOne(id)), generated };
  }

  async approve(id: string, actor: AuthenticatedUser) {
    await this.db.transaction(async (tx) => {
      const t = tx as unknown as Tx;
      const p = await this.draftOrThrow(id, t, true);
      const [{ n }] = await tx.select({ n: count() }).from(payoutLines).where(eq(payoutLines.statementId, id));
      if (!n) throw new BadRequestException('Add at least one line before approving');
      if (Number(p.total) < 0) throw new BadRequestException('A statement cannot total less than zero - carry the deduction to the next one instead');
      const now = new Date();
      await tx.update(payoutStatements).set({ status: 'APPROVED', approvedAt: now, approvedByUserId: actor.userId, updatedAt: now }).where(eq(payoutStatements.id, id));
    });
    return this.findOne(id);
  }

  /** APPROVED -> DRAFT, to correct something before it is paid. */
  async reopen(id: string) {
    await this.db.transaction(async (tx) => {
      const p = await this.statementOrThrow(id, tx as unknown as Tx, true);
      if (p.status !== 'APPROVED') throw new BadRequestException('Only an approved statement can go back to draft');
      await tx.update(payoutStatements).set({ status: 'DRAFT', approvedAt: null, approvedByUserId: null, updatedAt: new Date() }).where(eq(payoutStatements.id, id));
    });
    return this.findOne(id);
  }

  async pay(id: string, dto: PayPayoutDto, actor: AuthenticatedUser) {
    if (!isValidDate(dto.paidOn)) throw new BadRequestException('Enter the date it was paid');
    if (dto.paidOn > colomboToday()) throw new BadRequestException('A payment cannot be dated in the future');
    await this.db.transaction(async (tx) => {
      const p = await this.statementOrThrow(id, tx as unknown as Tx, true);
      if (p.status !== 'APPROVED') throw new BadRequestException('Approve the statement before marking it paid');
      const now = new Date();
      await tx
        .update(payoutStatements)
        .set({ status: 'PAID', paidOn: dto.paidOn, paymentMethod: dto.method, paymentReference: dto.reference ?? null, paidAt: now, paidByUserId: actor.userId, updatedAt: now })
        .where(eq(payoutStatements.id, id));
    });
    if (dto.notify !== false) void this.notifier.payoutPaid(id);
    return this.findOne(id);
  }

  async void(id: string, reason: string) {
    if (!reason?.trim()) throw new BadRequestException('Give a reason');
    await this.db.transaction(async (tx) => {
      const p = await this.statementOrThrow(id, tx as unknown as Tx, true);
      if (p.status === 'PAID') throw new BadRequestException('A paid statement cannot be voided - add a deduction to the next one instead');
      if (p.status === 'VOID') throw new BadRequestException('This statement is already void');
      await tx.update(payoutStatements).set({ status: 'VOID', voidedAt: new Date(), voidReason: reason.trim(), updatedAt: new Date() }).where(eq(payoutStatements.id, id));
    });
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.db.transaction(async (tx) => {
      await this.draftOrThrow(id, tx as unknown as Tx, true);
      await tx.delete(payoutLines).where(eq(payoutLines.statementId, id));
      await tx.delete(payoutStatements).where(eq(payoutStatements.id, id));
    });
    return { id, deleted: true };
  }

  /** A caregiver's own statements, approved or paid - never drafts. */
  async listForCaregiver(user: AuthenticatedUser): Promise<CaregiverPayout[]> {
    if (user.role !== 'CAREGIVER' || !user.caregiverId) throw new ForbiddenException('You do not have permission to perform this action');
    const rows = await this.db
      .select()
      .from(payoutStatements)
      .where(and(eq(payoutStatements.caregiverId, user.caregiverId), inArray(payoutStatements.status, ['APPROVED', 'PAID'])))
      .orderBy(desc(payoutStatements.periodEnd))
      .limit(50);
    if (!rows.length) return [];
    const lines = await this.db
      .select()
      .from(payoutLines)
      .where(inArray(payoutLines.statementId, rows.map((r) => r.id)))
      .orderBy(asc(payoutLines.position));
    return rows.map((r) => {
      const own = lines.filter((l) => l.statementId === r.id);
      const totals = computeTotals({ lines: own.map((l) => ({ ...l, taxable: false })) });
      return {
        id: r.id,
        reference: r.reference,
        status: r.status as CaregiverPayout['status'],
        periodStart: r.periodStart,
        periodEnd: r.periodEnd,
        lines: own.map((l, i) => ({
          description: l.description,
          serviceDate: l.serviceDate,
          quantity: l.quantity,
          unit: l.unit,
          unitPrice: l.unitPrice,
          discount: totals.lines[i].discount,
          amount: l.amount,
        })),
        total: r.total,
        paidOn: r.paidOn,
        paymentMethod: r.paymentMethod,
        paymentReference: r.paymentReference,
      };
    });
  }
}
