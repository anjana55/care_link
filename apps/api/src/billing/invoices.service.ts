import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID as uuid } from 'crypto';
import { and, asc, count, desc, eq, gte, inArray, isNotNull, like, lt, ne, or, sql, type SQL } from 'drizzle-orm';
import {
  addDays,
  colomboToUtc,
  colomboToday,
  computeTotals,
  daysInclusive,
  formatLkr,
  fromCents,
  isValidDate,
  toCents,
  type BillingParty,
  type ClientInvoice,
  type ShiftStatus,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  bookings,
  bookingShifts,
  cities,
  districts,
  invoiceEvents,
  invoiceLines,
  invoicePayments,
  invoices,
  patients,
  payhereCheckouts,
  users,
  type InvoiceEventType,
} from '../database/schema';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { BillingSettingsService } from './billing-settings.service';
import { BillingNotifier } from './billing-notifier.service';
import { buildLines, type BilledPeriod } from './line-builder';
import { fromBuilt, normalizeLines, type StoredLine } from './billing-lines';
import { appliedAdjustments, openAdjustmentLines } from './adjustments';
import { CreateInvoiceDto, InvoiceQueryDto, IssueInvoiceDto, RecordPaymentDto, ReplaceLinesDto, UpdateInvoiceDto } from './dto/billing.dto';

type Tx = Database;
type InvoiceRow = typeof invoices.$inferSelect;
type LineRow = typeof invoiceLines.$inferSelect;

/** The longest period one invoice may cover. */
export const MAX_INVOICE_DAYS = 366;

/** Which shifts each basis bills. Missed and cancelled shifts are never billed. */
const BASIS_STATUSES: Record<'COMPLETED' | 'SCHEDULED', ShiftStatus[]> = {
  COMPLETED: ['COMPLETED'],
  SCHEDULED: ['SCHEDULED', 'COMPLETED'],
};

/** How a payment reads in the history - English, like every other history note. */
/** What some lines come to, in cents - the room a carried credit has on the document. */
const linesCents = (lines: StoredLine[]) => lines.reduce((s, l) => s + toCents(l.amount), 0);

const METHOD_NOTE: Record<string, string> = { CASH: 'cash', BANK_TRANSFER: 'bank transfer', CHEQUE: 'cheque', CARD: 'card', PAYHERE: 'PayHere', OTHER: 'other' };
const paymentNote = (amount: string, method: string, reference?: string | null) =>
  [formatLkr(amount), METHOD_NOTE[method] ?? method, reference].filter(Boolean).join(' · ');

/**
 * Invoices to clients.
 *
 * A draft is made for a booking (or for all of a client's bookings) and a
 * period, and filled with one line per shift - the shifts done, or the shifts
 * scheduled when billing in advance - priced at the booking's rate. Staff then
 * shape it freely: change any price or quantity, discount a line or the whole
 * invoice, add charges, add credits, take lines out. Issuing numbers it,
 * freezes it and tells the client; from then on only payments move.
 *
 * The rule that must never break: a shift is billed at most once. A shift on
 * any invoice that is not VOID - drafts included - is left out of every new
 * one, and voiding an invoice is what frees its shifts again.
 */
@Injectable()
export class InvoicesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly settings: BillingSettingsService,
    private readonly notifier: BillingNotifier,
  ) {}

  // --- reading ---------------------------------------------------------------

  async findAll(query: InvoiceQueryDto) {
    const conditions: SQL[] = [];
    if (query.status) conditions.push(eq(invoices.status, query.status));
    if (query.overdue) conditions.push(eq(invoices.status, 'ISSUED'), lt(invoices.dueDate, colomboToday()));
    if (query.patientId) conditions.push(eq(invoices.patientId, query.patientId));
    if (query.bookingId) conditions.push(eq(invoices.bookingId, query.bookingId));
    if (query.search?.trim()) {
      const term = `%${query.search.trim()}%`;
      conditions.push(or(like(invoices.number, term), like(invoices.billToName, term), like(patients.fullName, term), like(bookings.reference, term))!);
    }
    const where = conditions.length ? and(...conditions) : undefined;
    const base = () =>
      this.db
        .select({
          id: invoices.id,
          number: invoices.number,
          status: invoices.status,
          basis: invoices.basis,
          issueDate: invoices.issueDate,
          dueDate: invoices.dueDate,
          periodStart: invoices.periodStart,
          periodEnd: invoices.periodEnd,
          total: invoices.total,
          amountPaid: invoices.amountPaid,
          clientId: patients.id,
          clientName: patients.fullName,
          billToName: invoices.billToName,
          bookingId: bookings.id,
          bookingReference: bookings.reference,
          createdAt: invoices.createdAt,
        })
        .from(invoices)
        .innerJoin(patients, eq(invoices.patientId, patients.id))
        .leftJoin(bookings, eq(invoices.bookingId, bookings.id));

    const [{ total }] = await this.db
      .select({ total: count() })
      .from(invoices)
      .innerJoin(patients, eq(invoices.patientId, patients.id))
      .leftJoin(bookings, eq(invoices.bookingId, bookings.id))
      .where(where);
    const rows = await base()
      .where(where)
      .orderBy(sql`FIELD(${invoices.status}, 'DRAFT', 'ISSUED', 'PAID', 'VOID')`, desc(invoices.issueDate), desc(invoices.createdAt))
      .limit(query.pageSize)
      .offset((query.page - 1) * query.pageSize);
    const today = colomboToday();
    return {
      items: rows.map((r) => ({
        ...r,
        balance: fromCents(toCents(r.total) - toCents(r.amountPaid)),
        overdue: r.status === 'ISSUED' && Boolean(r.dueDate) && r.dueDate! < today,
      })),
      page: query.page,
      pageSize: query.pageSize,
      total,
      totalPages: Math.ceil(total / query.pageSize),
    };
  }

  /** Counts and money for the list tabs and the dashboard. */
  async summary() {
    const rows = await this.db.select({ status: invoices.status, n: count() }).from(invoices).groupBy(invoices.status);
    const byStatus = { DRAFT: 0, ISSUED: 0, PAID: 0, VOID: 0 };
    for (const r of rows) byStatus[r.status] = r.n;
    const today = colomboToday();
    const [money] = await this.db
      .select({
        outstanding: sql<string>`COALESCE(SUM(${invoices.total} - ${invoices.amountPaid}), 0)`,
        overdue: sql<string>`COALESCE(SUM(CASE WHEN ${invoices.dueDate} < ${today} THEN ${invoices.total} - ${invoices.amountPaid} ELSE 0 END), 0)`,
        overdueCount: sql<number>`COALESCE(SUM(CASE WHEN ${invoices.dueDate} < ${today} THEN 1 ELSE 0 END), 0)`,
      })
      .from(invoices)
      .where(eq(invoices.status, 'ISSUED'));
    const monthStart = `${today.slice(0, 7)}-01`;
    const [received] = await this.db
      .select({ thisMonth: sql<string>`COALESCE(SUM(${invoicePayments.amount}), 0)` })
      .from(invoicePayments)
      .where(gte(invoicePayments.paidOn, monthStart));
    return {
      byStatus,
      outstanding: Number(money?.outstanding ?? 0).toFixed(2),
      overdue: Number(money?.overdue ?? 0).toFixed(2),
      overdueCount: Number(money?.overdueCount ?? 0),
      receivedThisMonth: Number(received?.thisMonth ?? 0).toFixed(2),
    };
  }

  async invoiceOrThrow(id: string, db: Tx = this.db, lock = false): Promise<InvoiceRow> {
    if (lock) await db.execute(sql`SELECT id FROM invoices WHERE id = ${id} FOR UPDATE`);
    const [row] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    if (!row) throw new NotFoundException('Invoice not found');
    return row;
  }

  private async draftOrThrow(id: string, db: Tx = this.db, lock = false) {
    const inv = await this.invoiceOrThrow(id, db, lock);
    if (inv.status !== 'DRAFT') throw new BadRequestException('Only a draft invoice can be changed - void it and make a corrected copy instead');
    return inv;
  }

  async findOne(id: string) {
    const inv = await this.invoiceOrThrow(id);
    const [lines, payments, events, checkouts, [client], booking, settings] = await Promise.all([
      this.db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.position)),
      this.db.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, id)).orderBy(asc(invoicePayments.paidOn), asc(invoicePayments.createdAt)),
      this.db.select().from(invoiceEvents).where(eq(invoiceEvents.invoiceId, id)).orderBy(asc(invoiceEvents.createdAt)),
      this.db.select().from(payhereCheckouts).where(eq(payhereCheckouts.invoiceId, id)).orderBy(desc(payhereCheckouts.createdAt)).limit(20),
      this.db.select({ id: patients.id, fullName: patients.fullName, phone: patients.phone }).from(patients).where(eq(patients.id, inv.patientId)).limit(1),
      inv.bookingId
        ? this.db
            .select({ id: bookings.id, reference: bookings.reference, rateType: bookings.rateType, rateAmount: bookings.rateAmount })
            .from(bookings)
            .where(eq(bookings.id, inv.bookingId))
            .limit(1)
        : Promise.resolve([]),
      this.settings.getResolved(),
    ]);
    const names = await this.userNames([inv.createdByUserId, inv.issuedByUserId, ...events.map((e) => e.actorUserId), ...payments.map((p) => p.recordedByUserId)]);
    const totals = computeTotals({ lines, discountType: inv.discountType, discountValue: inv.discountValue, taxRate: inv.taxRate });
    const balance = fromCents(toCents(inv.total) - toCents(inv.amountPaid));
    return {
      ...inv,
      seller: this.sellerFor(inv, settings),
      client: client ?? null,
      booking: booking[0] ?? null,
      lines: lines.map((l, i) => ({ ...l, gross: totals.lines[i].gross, discount: totals.lines[i].discount })),
      taxableAmount: totals.taxableAmount,
      balance,
      overdue: inv.status === 'ISSUED' && Boolean(inv.dueDate) && inv.dueDate! < colomboToday(),
      unpricedLines: lines.filter((l) => l.kind === 'SHIFT' && toCents(l.unitPrice) === 0).length,
      tax: { available: settings.taxEnabled, name: settings.taxName, rate: settings.taxRate },
      payhere: { usable: settings.payhereUsable },
      payments: payments.map((p) => ({ ...p, recordedBy: p.recordedByUserId ? (names.get(p.recordedByUserId) ?? null) : null })),
      checkouts: checkouts.map((c) => ({ id: c.id, amount: c.amount, status: c.status, mode: c.mode, method: c.method, paymentId: c.paymentId, createdAt: c.createdAt, updatedAt: c.updatedAt })),
      createdBy: inv.createdByUserId ? (names.get(inv.createdByUserId) ?? null) : null,
      issuedBy: inv.issuedByUserId ? (names.get(inv.issuedByUserId) ?? null) : null,
      events: events.map((e) => ({ id: e.id, type: e.type, note: e.note, createdAt: e.createdAt, actor: e.actorUserId ? (names.get(e.actorUserId) ?? null) : null })),
    };
  }

  /** A draft shows today's business details; an issued invoice keeps the ones it was issued with. */
  private sellerFor(inv: InvoiceRow, settings: Parameters<BillingSettingsService['sellerOf']>[0]): BillingParty {
    if (inv.sellerSnapshot) {
      try {
        return JSON.parse(inv.sellerSnapshot) as BillingParty;
      } catch {
        /* fall through to the current details */
      }
    }
    return this.settings.sellerOf(settings);
  }

  private async userNames(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
    const map = new Map<string, { id: string; fullName: string }>();
    if (!unique.length) return map;
    for (const r of await this.db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, unique))) map.set(r.id, r);
    return map;
  }

  async event(db: Tx, invoiceId: string, type: InvoiceEventType, actor: AuthenticatedUser | null, note?: string | null) {
    await db.insert(invoiceEvents).values({ id: uuid(), invoiceId, type, note: note ?? null, actorUserId: actor?.userId ?? null });
  }

  // --- making a draft ----------------------------------------------------------

  private validatePeriod(from?: string | null, to?: string | null) {
    if (!from && !to) return;
    if (!from || !to || !isValidDate(from) || !isValidDate(to)) throw new BadRequestException('Enter valid start and end dates');
    if (to < from) throw new BadRequestException('The end date must be on or after the start date');
    if (daysInclusive(from, to) > MAX_INVOICE_DAYS) throw new BadRequestException('One invoice can cover at most a year');
  }

  /**
   * Lines for the given bookings' shifts in [from, to], leaving out anything
   * already on a live invoice. `except` is an invoice whose own lines do not
   * count as "already billed" (none when making a new one).
   */
  private async linesFromShifts(
    db: Tx,
    opts: { bookingIds: string[]; from: string; to: string; statuses: ShiftStatus[]; language: InvoiceRow['language']; startAt: number },
  ) {
    if (!opts.bookingIds.length) return { lines: [] as StoredLine[], skipped: 0, unpriced: 0 };
    const bookingRows = await db
      .select({
        id: bookings.id,
        reference: bookings.reference,
        caregiverId: bookings.caregiverId,
        startDate: bookings.startDate,
        endDate: bookings.endDate,
        rateType: bookings.rateType,
        rateAmount: bookings.rateAmount,
      })
      .from(bookings)
      .where(inArray(bookings.id, opts.bookingIds));
    const shifts = await db
      .select({
        id: bookingShifts.id,
        bookingId: bookingShifts.bookingId,
        caregiverId: bookingShifts.caregiverId,
        startsAt: bookingShifts.startsAt,
        endsAt: bookingShifts.endsAt,
        status: bookingShifts.status,
        // The shift's own client rate, when it has one.
        rateType: bookingShifts.rateType,
        rateAmount: bookingShifts.rateAmount,
      })
      .from(bookingShifts)
      .where(
        and(
          inArray(bookingShifts.bookingId, opts.bookingIds),
          inArray(bookingShifts.status, opts.statuses),
          gte(bookingShifts.startsAt, colomboToUtc(opts.from, '00:00')),
          lt(bookingShifts.startsAt, colomboToUtc(addDays(opts.to, 1), '00:00')),
        ),
      );
    const { billedShiftIds, billedPeriods } = await this.billed(db, shifts.map((s) => s.id), opts.bookingIds);
    const built = buildLines({
      mode: 'INVOICE',
      language: opts.language,
      from: opts.from,
      to: opts.to,
      statuses: opts.statuses,
      bookings: bookingRows,
      shifts: shifts.map((s) => ({ ...s, startsAt: new Date(s.startsAt), endsAt: new Date(s.endsAt) })),
      billedShiftIds,
      billedPeriods,
    });
    return { lines: fromBuilt(built.lines, opts.startAt), skipped: built.skipped, unpriced: built.unpriced };
  }

  /** What is already on a live invoice - drafts count, void ones do not. */
  async billed(db: Tx, shiftIds: string[], bookingIds: string[]) {
    const billedShiftIds = new Set<string>();
    if (shiftIds.length) {
      const rows = await db
        .select({ shiftId: invoiceLines.shiftId })
        .from(invoiceLines)
        .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
        .where(and(inArray(invoiceLines.shiftId, shiftIds), ne(invoices.status, 'VOID')));
      for (const r of rows) if (r.shiftId) billedShiftIds.add(r.shiftId);
    }
    const billedPeriods: BilledPeriod[] = bookingIds.length
      ? (
          await db
            .select({ bookingId: invoiceLines.bookingId, periodStart: invoiceLines.periodStart, periodEnd: invoiceLines.periodEnd })
            .from(invoiceLines)
            .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
            .where(and(inArray(invoiceLines.bookingId, bookingIds), isNotNull(invoiceLines.periodStart), ne(invoices.status, 'VOID')))
        ).map((r) => ({ bookingId: r.bookingId!, periodStart: r.periodStart!, periodEnd: r.periodEnd! }))
      : [];
    return { billedShiftIds, billedPeriods };
  }

  async create(dto: CreateInvoiceDto, actor: AuthenticatedUser) {
    let patientId = dto.patientId;
    let bookingIds: string[] = [];
    let language = dto.language;
    if (dto.bookingId) {
      const [b] = await this.db.select().from(bookings).where(eq(bookings.id, dto.bookingId)).limit(1);
      if (!b) throw new NotFoundException('Booking not found');
      if (b.status === 'DRAFT') throw new BadRequestException('Confirm the booking before billing it');
      patientId = b.patientId;
      bookingIds = [b.id];
      language = language ?? b.language;
    }
    if (!patientId) throw new BadRequestException('Choose the client');
    const [patient] = await this.db.select().from(patients).where(eq(patients.id, patientId)).limit(1);
    if (!patient) throw new NotFoundException('Client not found');
    if (!dto.bookingId) {
      bookingIds = (
        await this.db
          .select({ id: bookings.id })
          .from(bookings)
          .where(and(eq(bookings.patientId, patientId), ne(bookings.status, 'DRAFT')))
      ).map((b) => b.id);
    }
    if (dto.basis !== 'MANUAL' && (!dto.periodStart || !dto.periodEnd)) throw new BadRequestException('Enter valid start and end dates');
    this.validatePeriod(dto.periodStart, dto.periodEnd);
    const [account] = await this.db.select({ email: users.email }).from(users).where(eq(users.id, patient.userId)).limit(1);
    // Clients pick their city from the list, so the place is usually an id, not text.
    const [place] = patient.cityId
      ? await this.db
          .select({ city: cities.nameEn, district: districts.nameEn })
          .from(cities)
          .innerJoin(districts, eq(cities.districtId, districts.id))
          .where(eq(cities.id, patient.cityId))
          .limit(1)
      : [];
    const settings = await this.settings.getResolved();
    const lang = language ?? 'en';

    const id = uuid();
    let generated = { added: 0, skipped: 0, unpriced: 0 };
    await this.db.transaction(async (tx) => {
      const t = tx as unknown as Tx;
      const built =
        dto.basis === 'MANUAL'
          ? { lines: [] as StoredLine[], skipped: 0, unpriced: 0 }
          : await this.linesFromShifts(t, { bookingIds, from: dto.periodStart!, to: dto.periodEnd!, statuses: BASIS_STATUSES[dto.basis], language: lang, startAt: 0 });
      // Corrections waiting for this client (this booking's, on a booking invoice).
      const carried = await openAdjustmentLines(t, { side: 'CLIENT', partyId: patientId!, bookingIds: dto.bookingId ? [dto.bookingId] : null, language: lang, startAt: built.lines.length, baseCents: linesCents(built.lines) });
      generated = { added: built.lines.length, skipped: built.skipped, unpriced: built.unpriced };
      await tx.insert(invoices).values({
        id,
        patientId: patientId!,
        bookingId: dto.bookingId ?? null,
        status: 'DRAFT',
        basis: dto.basis,
        periodStart: dto.periodStart ?? null,
        periodEnd: dto.periodEnd ?? null,
        language: lang,
        billToName: patient.fullName,
        billToAddress: [patient.permanentAddress ?? patient.careAddress, place?.city ?? patient.city, place?.district ?? patient.district].filter(Boolean).join(', ') || null,
        billToPhone: patient.phone,
        billToEmail: account?.email ?? null,
        taxName: settings.taxEnabled ? settings.taxName : null,
        taxRate: settings.taxEnabled ? settings.taxRate : null,
        createdByUserId: actor.userId,
      });
      await this.insertLines(t, id, [...built.lines, ...carried]);
      await this.recalc(t, id);
      const notes = [
        dto.basis === 'MANUAL' ? null : `${built.lines.length} lines from shifts${built.skipped ? `; ${built.skipped} already billed, left out` : ''}`,
        carried.length ? `${carried.length} correction${carried.length === 1 ? '' : 's'} carried from earlier invoices` : null,
      ].filter(Boolean);
      await this.event(t, id, 'CREATED', actor, notes.length ? notes.join('; ') : null);
    });
    return { ...(await this.findOne(id)), generated };
  }

  async insertLines(db: Tx, invoiceId: string, lines: StoredLine[]) {
    for (let i = 0; i < lines.length; i += 200) {
      await db.insert(invoiceLines).values(
        lines.slice(i, i + 200).map((l) => ({
          ...l,
          invoiceId,
          taxable: l.taxable ?? true,
        })),
      );
    }
  }

  /**
   * Re-works the stored totals from the lines, discount and tax - and, for an
   * issued invoice, the status from the payments. Every write ends here.
   */
  async recalc(db: Tx, id: string) {
    const [inv] = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
    const lines = await db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.position));
    const totals = computeTotals({ lines, discountType: inv.discountType, discountValue: inv.discountValue, taxRate: inv.taxRate });
    const [{ paid }] = await db
      .select({ paid: sql<string>`COALESCE(SUM(${invoicePayments.amount}), 0)` })
      .from(invoicePayments)
      .where(eq(invoicePayments.invoiceId, id));
    const amountPaid = fromCents(toCents(Number(paid).toFixed(2)));
    let status = inv.status;
    let paidAt = inv.paidAt;
    if (inv.status === 'ISSUED' || inv.status === 'PAID') {
      const settled = toCents(amountPaid) >= toCents(totals.total);
      status = settled ? 'PAID' : 'ISSUED';
      paidAt = settled ? (inv.paidAt ?? new Date()) : null;
    }
    await db
      .update(invoices)
      .set({
        subtotal: totals.subtotal,
        discountAmount: totals.discount,
        taxAmount: totals.tax,
        total: totals.total,
        amountPaid,
        status,
        paidAt,
        updatedAt: new Date(),
      })
      .where(eq(invoices.id, id));
    return { before: inv.status, after: status };
  }

  // --- shaping a draft -----------------------------------------------------------

  async update(id: string, dto: UpdateInvoiceDto, actor: AuthenticatedUser) {
    const inv = await this.draftOrThrow(id);
    const periodStart = dto.periodStart ?? inv.periodStart;
    const periodEnd = dto.periodEnd ?? inv.periodEnd;
    this.validatePeriod(periodStart, periodEnd);
    const discountType = dto.discountType === undefined ? inv.discountType : dto.discountType;
    const discountValue = dto.discountValue === undefined ? inv.discountValue : dto.discountValue;
    if (discountType === 'PERCENT' && discountValue && toCents(discountValue) > 10000) throw new BadRequestException('A discount cannot be more than 100%');
    if (dto.billToName !== undefined && !dto.billToName) throw new BadRequestException('Enter who the invoice is addressed to');
    const settings = dto.applyTax ? await this.settings.getResolved() : null;
    if (dto.applyTax && !settings!.taxEnabled) throw new BadRequestException('Turn tax on in Settings > Billing first');
    const text = (v: string | undefined, fallback: string | null) => (v === undefined ? fallback : v.trim() || null);

    await this.db.transaction(async (tx) => {
      await tx
        .update(invoices)
        .set({
          billToName: dto.billToName ?? inv.billToName,
          billToAddress: text(dto.billToAddress, inv.billToAddress),
          billToPhone: text(dto.billToPhone, inv.billToPhone),
          billToEmail: text(dto.billToEmail, inv.billToEmail),
          periodStart,
          periodEnd,
          discountType: discountType && discountValue && toCents(discountValue) > 0 ? discountType : null,
          discountValue: discountType && discountValue && toCents(discountValue) > 0 ? discountValue : null,
          discountReason: dto.discountReason === undefined ? inv.discountReason : dto.discountReason?.trim() || null,
          ...(dto.applyTax === true ? { taxName: settings!.taxName, taxRate: settings!.taxRate } : {}),
          ...(dto.applyTax === false ? { taxName: null, taxRate: null } : {}),
          notes: text(dto.notes, inv.notes),
          language: dto.language ?? inv.language,
          updatedAt: new Date(),
        })
        .where(eq(invoices.id, id));
      await this.recalc(tx as unknown as Tx, id);
      await this.event(tx as unknown as Tx, id, 'UPDATED', actor);
    });
    return this.findOne(id);
  }

  /** The editor's Save: the whole table, in order. */
  async replaceLines(id: string, dto: ReplaceLinesDto, actor: AuthenticatedUser) {
    await this.db.transaction(async (tx) => {
      const t = tx as unknown as Tx;
      await this.draftOrThrow(id, t, true);
      const existing = (await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id))) as LineRow[];
      const next = normalizeLines(dto.lines, existing, true);
      await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, id));
      await this.insertLines(t, id, next);
      await this.recalc(t, id);
      const removed = existing.length - next.filter((l) => existing.some((e) => e.id === l.id)).length;
      const added = next.filter((l) => !existing.some((e) => e.id === l.id)).length;
      await this.event(t, id, 'LINES_CHANGED', actor, `${next.length} lines${added ? `, ${added} added` : ''}${removed ? `, ${removed} removed` : ''}`);
    });
    return this.findOne(id);
  }

  /** Adds the shifts in the period that are not billed yet - e.g. after more were marked done. */
  async addShiftLines(id: string, actor: AuthenticatedUser) {
    let generated = { added: 0, skipped: 0, unpriced: 0 };
    await this.db.transaction(async (tx) => {
      const t = tx as unknown as Tx;
      const inv = await this.draftOrThrow(id, t, true);
      if (inv.basis === 'MANUAL' || !inv.periodStart || !inv.periodEnd) throw new BadRequestException('This invoice is not billed from shifts - add lines by hand');
      const bookingIds = inv.bookingId
        ? [inv.bookingId]
        : (await tx.select({ id: bookings.id }).from(bookings).where(and(eq(bookings.patientId, inv.patientId), ne(bookings.status, 'DRAFT')))).map((b) => b.id);
      const [{ maxPos }] = await tx.select({ maxPos: sql<number>`COALESCE(MAX(${invoiceLines.position}), -1)` }).from(invoiceLines).where(eq(invoiceLines.invoiceId, id));
      const built = await this.linesFromShifts(t, {
        bookingIds,
        from: inv.periodStart,
        to: inv.periodEnd,
        statuses: BASIS_STATUSES[inv.basis],
        language: inv.language,
        startAt: Number(maxPos) + 1,
      });
      // Already on THIS invoice is "billed" too - which is exactly what we want.
      const carried = await openAdjustmentLines(t, {
        side: 'CLIENT',
        partyId: inv.patientId,
        bookingIds: inv.bookingId ? [inv.bookingId] : null,
        language: inv.language,
        startAt: Number(maxPos) + 1 + built.lines.length,
        // What the draft already comes to, plus what is being added.
        baseCents: linesCents((await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id))) as StoredLine[]) + linesCents(built.lines),
      });
      generated = { added: built.lines.length, skipped: built.skipped, unpriced: built.unpriced };
      await this.insertLines(t, id, [...built.lines, ...carried]);
      await this.recalc(t, id);
      await this.event(t, id, 'LINES_CHANGED', actor, `${built.lines.length} lines added from shifts${carried.length ? `, ${carried.length} corrections carried` : ''}`);
    });
    return { ...(await this.findOne(id)), generated };
  }

  async remove(id: string, actor: AuthenticatedUser) {
    await this.db.transaction(async (tx) => {
      await this.draftOrThrow(id, tx as unknown as Tx, true);
      await tx.delete(invoiceLines).where(eq(invoiceLines.invoiceId, id));
      await tx.delete(invoiceEvents).where(eq(invoiceEvents.invoiceId, id));
      await tx.delete(invoices).where(eq(invoices.id, id));
    });
    void actor;
    return { id, deleted: true };
  }

  // --- issuing and after ---------------------------------------------------------

  async issue(id: string, dto: IssueInvoiceDto, actor: AuthenticatedUser) {
    const issueDate = dto.issueDate ?? colomboToday();
    if (!isValidDate(issueDate)) throw new BadRequestException('Enter the issue date');
    await this.db.transaction(async (tx) => {
      const t = tx as unknown as Tx;
      const inv = await this.draftOrThrow(id, t, true);
      const lines = await tx.select({ id: invoiceLines.id }).from(invoiceLines).where(eq(invoiceLines.invoiceId, id));
      if (!lines.length) throw new BadRequestException('Add at least one line before issuing');
      if (toCents(inv.total) < 0) throw new BadRequestException('An invoice cannot total less than zero - carry the credit to the next invoice instead');
      const { number, settings } = await this.settings.takeInvoiceNumber(t);
      const dueDate = dto.dueDate ?? addDays(issueDate, settings.paymentTermsDays);
      if (!isValidDate(dueDate) || dueDate < issueDate) throw new BadRequestException('The due date must be on or after the issue date');
      const now = new Date();
      await tx
        .update(invoices)
        .set({
          number,
          status: 'ISSUED',
          issueDate,
          dueDate,
          sellerSnapshot: JSON.stringify(this.settings.sellerOf(settings)),
          footer: settings.invoiceFooter,
          issuedAt: now,
          issuedByUserId: actor.userId,
          updatedAt: now,
        })
        .where(eq(invoices.id, id));
      await this.recalc(t, id); // a zero-total invoice is settled the moment it is issued
      await this.event(t, id, 'ISSUED', actor, number);
    });
    if (dto.notify !== false) void this.notifier.invoiceIssued(id);
    return this.findOne(id);
  }

  async send(id: string, actor: AuthenticatedUser) {
    const inv = await this.invoiceOrThrow(id);
    if (inv.status !== 'ISSUED' && inv.status !== 'PAID') throw new BadRequestException('Only an issued invoice can be sent');
    const sent = await (inv.status === 'PAID' ? this.notifier.invoicePaid(id) : this.notifier.invoiceIssued(id));
    if (!sent) throw new ConflictException('The client has no email address and WhatsApp updates are off - share the invoice another way');
    await this.event(this.db, id, 'SENT', actor);
    return this.findOne(id);
  }

  /** ISSUED with nothing paid -> VOID. Its number stays used; its shifts are free to bill again. */
  async void(id: string, reason: string, actor: AuthenticatedUser) {
    if (!reason?.trim()) throw new BadRequestException('Give a reason');
    await this.db.transaction(async (tx) => {
      await this.voidIn(tx as unknown as Tx, id, reason.trim(), actor);
    });
    return this.findOne(id);
  }

  /** The void itself, inside the caller's transaction (also used by booking corrections). */
  async voidIn(t: Tx, id: string, reason: string, actor: AuthenticatedUser) {
    const inv = await this.invoiceOrThrow(id, t, true);
    if (inv.status === 'DRAFT') throw new BadRequestException('A draft is not voided - delete it instead');
    if (inv.status === 'VOID') throw new BadRequestException('This invoice is already void');
    if (toCents(inv.amountPaid) !== 0) throw new BadRequestException('Refund the payments on this invoice before voiding it');
    await t.update(invoices).set({ status: 'VOID', voidedAt: new Date(), voidReason: reason, updatedAt: new Date() }).where(eq(invoices.id, id));
    await this.event(t, id, 'VOIDED', actor, reason);
  }

  /**
   * A new draft copying `inv`'s addressing, discount and notes, with the given
   * lines - the corrected copy of a voided invoice. Tax follows today's
   * settings (as on any new draft) if the original was taxed.
   */
  async copyAsDraftIn(t: Tx, inv: InvoiceRow, lines: StoredLine[], actor: AuthenticatedUser, note: string) {
    const copyId = uuid();
    const settings = await this.settings.getResolved();
    await t.insert(invoices).values({
      id: copyId,
      patientId: inv.patientId,
      bookingId: inv.bookingId,
      status: 'DRAFT',
      basis: inv.basis,
      periodStart: inv.periodStart,
      periodEnd: inv.periodEnd,
      language: inv.language,
      billToName: inv.billToName,
      billToAddress: inv.billToAddress,
      billToPhone: inv.billToPhone,
      billToEmail: inv.billToEmail,
      discountType: inv.discountType,
      discountValue: inv.discountValue,
      discountReason: inv.discountReason,
      taxName: inv.taxRate && settings.taxEnabled ? settings.taxName : null,
      taxRate: inv.taxRate && settings.taxEnabled ? settings.taxRate : null,
      notes: inv.notes,
      createdByUserId: actor.userId,
    });
    await this.insertLines(t, copyId, lines.map((l, i) => ({ ...l, id: uuid(), position: i })));
    await this.recalc(t, copyId);
    await this.event(t, copyId, 'CREATED', actor, note);
    return copyId;
  }

  /**
   * The usual fix for a wrong invoice: void it and start a draft copy with the
   * same lines (shifts included), which staff correct and issue as a new number.
   */
  async revise(id: string, reason: string, actor: AuthenticatedUser) {
    const original = await this.invoiceOrThrow(id);
    if (original.status !== 'VOID') await this.void(id, reason, actor);
    let copyId = '';
    await this.db.transaction(async (tx) => {
      const t = tx as unknown as Tx;
      const inv = await this.invoiceOrThrow(id, t, true);
      const lines = await tx.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.position));
      // The copy may only take shifts (and carried corrections) nobody else has billed since the void.
      const { billedShiftIds, billedPeriods } = await this.billed(
        t,
        lines.map((l) => l.shiftId).filter((v): v is string => Boolean(v)),
        [...new Set(lines.map((l) => l.bookingId).filter((v): v is string => Boolean(v)))],
      );
      const applied = await appliedAdjustments(t, lines.map((l) => l.adjustmentId).filter((v): v is string => Boolean(v)));
      const free = lines.filter(
        (l) =>
          !(l.shiftId && billedShiftIds.has(l.shiftId)) &&
          !(l.adjustmentId && applied.has(l.adjustmentId)) &&
          !(l.periodStart && billedPeriods.some((p) => p.bookingId === l.bookingId && p.periodStart <= l.periodEnd! && l.periodStart! <= p.periodEnd)),
      );
      copyId = await this.copyAsDraftIn(t, inv, free, actor, `Corrected copy of ${inv.number ?? 'a void invoice'}`);
    });
    return this.findOne(copyId);
  }

  async addNote(id: string, note: string, actor: AuthenticatedUser) {
    if (!note?.trim()) throw new BadRequestException('Write a note first');
    await this.invoiceOrThrow(id);
    await this.event(this.db, id, 'NOTE', actor, note.trim());
    return this.findOne(id);
  }

  // --- money ---------------------------------------------------------------------

  async recordPayment(id: string, dto: RecordPaymentDto, actor: AuthenticatedUser) {
    const kind = dto.kind ?? 'PAYMENT';
    if (!isValidDate(dto.paidOn)) throw new BadRequestException('Enter the date it was paid');
    if (dto.paidOn > colomboToday()) throw new BadRequestException('A payment cannot be dated in the future');
    const cents = toCents(dto.amount);
    if (cents <= 0) throw new BadRequestException('The amount must be more than zero');
    let change = { before: 'ISSUED', after: 'ISSUED' } as Awaited<ReturnType<InvoicesService['recalc']>>;
    await this.db.transaction(async (tx) => {
      const t = tx as unknown as Tx;
      const inv = await this.invoiceOrThrow(id, t, true);
      if (inv.status !== 'ISSUED' && inv.status !== 'PAID') throw new BadRequestException('Payments are recorded against an issued invoice');
      const balance = toCents(inv.total) - toCents(inv.amountPaid);
      if (kind === 'PAYMENT' && cents > balance) throw new BadRequestException('That is more than the balance due');
      if (kind === 'REFUND' && cents > toCents(inv.amountPaid)) throw new BadRequestException('That is more than has been paid');
      const amount = kind === 'REFUND' ? fromCents(-cents) : fromCents(cents);
      await tx.insert(invoicePayments).values({
        id: uuid(),
        invoiceId: id,
        amount,
        method: dto.method,
        paidOn: dto.paidOn,
        reference: dto.reference ?? null,
        note: dto.note ?? null,
        recordedByUserId: actor.userId,
      });
      change = await this.recalc(t, id);
      await this.event(t, id, kind, actor, paymentNote(amount, dto.method, dto.reference));
      if (change.before !== change.after) await this.event(t, id, change.after === 'PAID' ? 'PAID' : 'REOPENED', actor);
    });
    if (change.after === 'PAID' && change.before !== 'PAID' && dto.notify !== false) void this.notifier.invoicePaid(id);
    return this.findOne(id);
  }

  /** Takes back an entry recorded by mistake. PayHere's own entries are never deleted - refund instead. */
  async deletePayment(id: string, paymentId: string, actor: AuthenticatedUser) {
    await this.db.transaction(async (tx) => {
      const t = tx as unknown as Tx;
      await this.invoiceOrThrow(id, t, true);
      const [p] = await tx
        .select()
        .from(invoicePayments)
        .where(and(eq(invoicePayments.id, paymentId), eq(invoicePayments.invoiceId, id)))
        .limit(1);
      if (!p) throw new NotFoundException('Payment not found');
      if (p.method === 'PAYHERE') throw new BadRequestException('An online payment cannot be deleted - record a refund instead');
      await tx.delete(invoicePayments).where(eq(invoicePayments.id, paymentId));
      const change = await this.recalc(t, id);
      await this.event(t, id, 'PAYMENT_DELETED', actor, `${paymentNote(p.amount, p.method, p.reference)} · ${p.paidOn}`);
      if (change.before !== change.after) await this.event(t, id, change.after === 'PAID' ? 'PAID' : 'REOPENED', actor);
    });
    return this.findOne(id);
  }

  /**
   * A payment that did not come from staff: PayHere's notification. The
   * external id is unique, so a notification delivered twice is counted once.
   * Returns true when it settled the invoice.
   */
  async applyExternalPayment(
    tx: Tx,
    invoiceId: string,
    p: { amount: string; method: 'PAYHERE'; externalId: string; reference: string | null; note: string | null },
  ): Promise<{ applied: boolean; settled: boolean }> {
    const [dup] = await tx.select({ id: invoicePayments.id }).from(invoicePayments).where(eq(invoicePayments.externalId, p.externalId)).limit(1);
    if (dup) return { applied: false, settled: false };
    const inv = await this.invoiceOrThrow(invoiceId, tx, true);
    await tx.insert(invoicePayments).values({
      id: uuid(),
      invoiceId,
      amount: p.amount,
      method: p.method,
      paidOn: colomboToday(),
      reference: p.reference,
      note: p.note,
      externalId: p.externalId,
      recordedByUserId: null,
    });
    const change = await this.recalc(tx, invoiceId);
    await this.event(tx, invoiceId, toCents(p.amount) < 0 ? 'REFUND' : 'PAYMENT', null, paymentNote(p.amount, 'PAYHERE', p.reference));
    if (change.before !== change.after) await this.event(tx, invoiceId, change.after === 'PAID' ? 'PAID' : 'REOPENED', null);
    void inv;
    return { applied: true, settled: change.after === 'PAID' && change.before !== 'PAID' };
  }

  // --- the client's own view -------------------------------------------------------

  private assertClient(user: AuthenticatedUser) {
    if (user.role !== 'PATIENT_GUARDIAN' || !user.patientId) throw new ForbiddenException('You do not have permission to perform this action');
    return user.patientId;
  }

  async listForClient(user: AuthenticatedUser): Promise<ClientInvoice[]> {
    const patientId = this.assertClient(user);
    const rows = await this.db
      .select({ id: invoices.id })
      .from(invoices)
      .where(and(eq(invoices.patientId, patientId), ne(invoices.status, 'DRAFT')))
      .orderBy(desc(invoices.issueDate), desc(invoices.createdAt))
      .limit(100);
    const settings = await this.settings.getResolved();
    return Promise.all(rows.map((r) => this.clientView(r.id, settings)));
  }

  async findForClient(user: AuthenticatedUser, id: string): Promise<ClientInvoice> {
    const patientId = this.assertClient(user);
    const [row] = await this.db.select({ patientId: invoices.patientId, status: invoices.status }).from(invoices).where(eq(invoices.id, id)).limit(1);
    // Someone else's invoice, or a draft, is simply not there.
    if (!row || row.patientId !== patientId || row.status === 'DRAFT') throw new NotFoundException('Invoice not found');
    return this.clientView(id, await this.settings.getResolved());
  }

  private async clientView(id: string, settings: Awaited<ReturnType<BillingSettingsService['getResolved']>>): Promise<ClientInvoice> {
    const inv = await this.invoiceOrThrow(id);
    const [lines, payments, booking] = await Promise.all([
      this.db.select().from(invoiceLines).where(eq(invoiceLines.invoiceId, id)).orderBy(asc(invoiceLines.position)),
      this.db.select().from(invoicePayments).where(eq(invoicePayments.invoiceId, id)).orderBy(asc(invoicePayments.paidOn)),
      inv.bookingId ? this.db.select({ reference: bookings.reference }).from(bookings).where(eq(bookings.id, inv.bookingId)).limit(1) : Promise.resolve([]),
    ]);
    const totals = computeTotals({ lines, discountType: inv.discountType, discountValue: inv.discountValue, taxRate: inv.taxRate });
    const balance = fromCents(toCents(inv.total) - toCents(inv.amountPaid));
    const discountLabel = inv.discountType ? [inv.discountType === 'PERCENT' ? `${Number(inv.discountValue)}%` : null, inv.discountReason].filter(Boolean).join(' · ') || null : null;
    return {
      id: inv.id,
      number: inv.number!,
      status: inv.status as ClientInvoice['status'],
      issueDate: inv.issueDate!,
      dueDate: inv.dueDate!,
      periodStart: inv.periodStart,
      periodEnd: inv.periodEnd,
      bookingReference: booking[0]?.reference ?? null,
      seller: this.sellerFor(inv, settings),
      billTo: { name: inv.billToName, address: inv.billToAddress, phone: inv.billToPhone, email: inv.billToEmail },
      lines: lines.map((l, i) => ({
        description: l.description,
        serviceDate: l.serviceDate,
        quantity: l.quantity,
        unit: l.unit,
        unitPrice: l.unitPrice,
        discount: totals.lines[i].discount,
        amount: l.amount,
      })),
      subtotal: inv.subtotal,
      discount: inv.discountAmount,
      discountLabel,
      taxName: inv.taxName,
      taxRate: inv.taxRate,
      tax: inv.taxAmount,
      total: inv.total,
      amountPaid: inv.amountPaid,
      balance,
      overdue: inv.status === 'ISSUED' && inv.dueDate! < colomboToday(),
      notes: inv.notes,
      footer: inv.footer,
      payments: payments.map((p) => ({ paidOn: p.paidOn, amount: p.amount, method: p.method, reference: p.reference })),
      canPayOnline: inv.status === 'ISSUED' && toCents(balance) > 0 && settings.payhereUsable,
    };
  }

  /** For the PayHere checkout: the invoice must be the caller's, issued and owing. */
  async payableForClient(user: AuthenticatedUser, id: string) {
    const patientId = this.assertClient(user);
    const inv = await this.invoiceOrThrow(id);
    if (inv.patientId !== patientId || inv.status === 'DRAFT') throw new NotFoundException('Invoice not found');
    if (inv.status !== 'ISSUED') throw new BadRequestException('This invoice has nothing left to pay');
    const balance = toCents(inv.total) - toCents(inv.amountPaid);
    if (balance <= 0) throw new BadRequestException('This invoice has nothing left to pay');
    return { invoice: inv, balance: fromCents(balance) };
  }
}
