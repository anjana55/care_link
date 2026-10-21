import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID as uuid } from 'crypto';
import { and, asc, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  formatLkr,
  isoToColomboLocal,
  toCents,
  type AmendmentPreview,
  type BookingAmendmentSummary,
  type BookingAmendmentView,
  type ShiftStatus,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  billingAdjustments,
  bookingAmendments,
  bookingIssueReports,
  bookings,
  bookingShifts,
  caregivers,
  invoiceLines,
  invoices,
  patients,
  payoutLines,
  payoutStatements,
  users,
  BLOCKING_SHIFT_STATUSES,
} from '../database/schema';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { BookingsService } from '../bookings/bookings.service';
import { InvoicesService } from '../billing/invoices.service';
import { PayoutsService } from '../billing/payouts.service';
import { AdjustmentsService } from '../billing/adjustments.service';
import type { StoredLine } from '../billing/billing-lines';
import { describeChanges, planAmendment, type AmendmentPlan, type PlanBooking, type PlanDocument, type PlanLine, type PlanShift, type RebuiltLine } from './amendment-plan';
import type { AmendBookingDto } from './dto/amend-booking.dto';
import { CorrectionsNotifier, type CorrectionNotices } from './corrections-notifier.service';

type Tx = Database;
type BookingRow = typeof bookings.$inferSelect;
type ShiftRow = typeof bookingShifts.$inferSelect;

/** Like booking writes, corrections check overlaps under READ COMMITTED (see bookings.service.ts). */
const CHECKED = { isolationLevel: 'read committed' as const };

/** Amounts as stored ("3500" -> "3500.00"), so an unchanged rate never reads as a change. */
const money = (a: string | null | undefined) => (a === null || a === undefined || a === '' ? null : Number(a).toFixed(2));
const isoLocal = (d: Date) => isoToColomboLocal(d);

/**
 * Corrections to work that already happened (or is already billed): the
 * shift that ran three hours longer, the one that was missed, the one a cover
 * worked, the rate that was wrong all along.
 *
 * A correction is previewed, then applied. Both run the same code inside one
 * transaction - the preview simply rolls it back - so what staff saw is what
 * happens, re-checked against whatever changed in between.
 *
 * Shift rules are the roster's own (times, overlap, monthly rate locks); the
 * money rules are in amendment-plan.ts. Nothing the client or caregiver has
 * already seen is rewritten: drafts are refreshed, an unpaid issued invoice
 * can be replaced by a corrected copy, and everything else is carried as a
 * billing adjustment onto the next invoice or pay statement.
 */
@Injectable()
export class CorrectionsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly bookingsService: BookingsService,
    private readonly invoicesService: InvoicesService,
    private readonly payoutsService: PayoutsService,
    private readonly adjustments: AdjustmentsService,
    private readonly notifier: CorrectionsNotifier,
  ) {}

  async preview(bookingId: string, dto: AmendBookingDto, actor: AuthenticatedUser): Promise<AmendmentPreview> {
    return (await this.run(bookingId, dto, actor, false)) as AmendmentPreview;
  }

  async apply(bookingId: string, dto: AmendBookingDto, actor: AuthenticatedUser) {
    const notices = (await this.run(bookingId, dto, actor, true)) as CorrectionNotices;
    // After the commit, and never holding up the reply: whoever's money or shifts changed is told.
    void this.notifier.send(notices);
    return this.bookingsService.findOne(bookingId);
  }

  /** The booking's corrections and the adjustments they left, newest first. */
  async history(bookingId: string): Promise<{ amendments: BookingAmendmentView[]; adjustments: Awaited<ReturnType<AdjustmentsService['list']>> }> {
    const rows = await this.db.select().from(bookingAmendments).where(eq(bookingAmendments.bookingId, bookingId)).orderBy(desc(bookingAmendments.createdAt));
    const actorIds = [...new Set(rows.map((r) => r.actorUserId).filter((v): v is string => Boolean(v)))];
    const names = new Map(
      actorIds.length ? (await this.db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, actorIds))).map((u) => [u.id, u]) : [],
    );
    const amendments = rows.map((r) => {
      let summary: BookingAmendmentSummary = { changes: [], documents: [], adjustments: [] };
      try {
        summary = JSON.parse(r.summary) as BookingAmendmentSummary;
      } catch {
        /* an unreadable summary still shows its reason */
      }
      return { id: r.id, reason: r.reason, summary, actor: r.actorUserId ? (names.get(r.actorUserId) ?? null) : null, createdAt: new Date(r.createdAt).toISOString() };
    });
    return { amendments, adjustments: await this.adjustments.list({ bookingId }) };
  }

  // --- the work -----------------------------------------------------------------

  /**
   * Works the correction out. A preview writes nothing and returns what would
   * happen; with `commit` it is written, and what comes back is who to tell.
   */
  private async run(bookingId: string, dto: AmendBookingDto, actor: AuthenticatedUser, commit: boolean): Promise<AmendmentPreview | CorrectionNotices> {
    if (!dto.reason?.trim()) throw new BadRequestException('Say what was wrong');
    if (!dto.shifts?.length && !dto.addShifts?.length && dto.rateAmount === undefined && dto.payRateAmount === undefined && !dto.close) {
      throw new BadRequestException('Choose what to correct: a shift, a missing shift, or the rate');
    }
    for (const [id, choice] of Object.entries(dto.invoiceActions ?? {})) {
      if (choice !== 'REPLACE' && choice !== 'CARRY') throw new BadRequestException(`Choose how invoice ${id} takes the correction`);
    }

    return this.db.transaction(async (tx): Promise<AmendmentPreview | CorrectionNotices> => {
      const t = tx as unknown as Tx;
      // One correction at a time per booking.
      await t.execute(sql`SELECT id FROM bookings WHERE id = ${bookingId} FOR UPDATE`);
      const [booking] = await t.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
      if (!booking) throw new NotFoundException('Booking not found');
      if (booking.status !== 'CONFIRMED' && booking.status !== 'COMPLETED') {
        throw new BadRequestException(booking.status === 'DRAFT' ? 'A draft booking is edited directly - nothing has happened or been billed yet' : 'A cancelled booking cannot be corrected');
      }
      if (dto.close && booking.status !== 'CONFIRMED') throw new BadRequestException('This booking is already closed');
      const issues = await this.openIssues(t, bookingId, dto.issueIds ?? []);

      const shiftRows = await t.select().from(bookingShifts).where(eq(bookingShifts.bookingId, bookingId)).orderBy(asc(bookingShifts.startsAt));
      const before = { booking: toPlanBooking(booking), shifts: shiftRows.map(toPlanShift) };
      const after = await this.corrected(t, booking, shiftRows, dto);
      const touched = new Set([...(dto.shifts ?? []).map((s) => s.shiftId), ...after.added.map((s) => s.id), ...after.closing]);

      // The roster's one hard rule: no caregiver holds two overlapping shifts.
      const held = after.shifts.filter((s) => {
        if (!touched.has(s.id) || !BLOCKING_SHIFT_STATUSES.includes(s.status)) return false;
        const old = before.shifts.find((o) => o.id === s.id);
        return !old || old.startsAt.getTime() !== s.startsAt.getTime() || old.endsAt.getTime() !== s.endsAt.getTime() || old.caregiverId !== s.caregiverId || old.status !== s.status;
      });
      if (held.length) {
        await this.bookingsService.lockCaregivers(t, held.map((s) => s.caregiverId));
        await this.bookingsService.assertNoOverlap(t, held);
      }

      const documents = await this.documentsFor(t, booking);
      const caregiverIds = [...new Set([booking.caregiverId, ...before.shifts.map((s) => s.caregiverId), ...after.shifts.map((s) => s.caregiverId)])];
      const names = new Map((await t.select({ id: caregivers.id, fullName: caregivers.fullName }).from(caregivers).where(inArray(caregivers.id, caregiverIds))).map((c) => [c.id, c.fullName]));
      const [client] = await t.select({ fullName: patients.fullName }).from(patients).where(eq(patients.id, booking.patientId)).limit(1);

      const plan = planAmendment({ before, after: { booking: after.booking, shifts: after.shifts }, touched, documents, caregiverNames: names, clientName: client?.fullName ?? null, invoiceChoices: dto.invoiceActions });
      // Shifts cancelled only because the booking is closing read as one line, not one each.
      const closing = new Set(after.closing);
      const changes = describeChanges(before, { booking: after.booking, shifts: after.shifts }, new Set([...touched].filter((id) => !closing.has(id))), names);
      if (dto.close) {
        changes.push({
          shiftId: null,
          date: '',
          changes: [
            `booking ${dto.close === 'COMPLETED' ? 'completed' : 'cancelled'}${closing.size ? `; ${closing.size} upcoming shift${closing.size === 1 ? '' : 's'} cancelled` : ''}`,
          ],
        });
      }
      const anyChange = Boolean(dto.close) || changes.some((c) => !(c.changes.length === 1 && c.changes[0].startsWith('re-checked')));
      if (!anyChange && !plan.documents.length) throw new BadRequestException('Nothing here changes the booking or its billing');

      const preview: AmendmentPreview = {
        changes,
        documents: plan.documents.map(({ rebuilt: _rebuilt, ...d }) => d),
        adjustments: plan.adjustments.map((a) => ({ side: a.side, partyName: a.partyName, amount: a.amount, taxable: a.taxable, description: a.description, sourceLabel: a.sourceLabel })),
        unbilled: plan.unbilled,
        warnings: plan.warnings,
        ...(dto.close ? { close: { status: dto.close, upcomingCancelled: closing.size } } : {}),
      };
      if (!commit) return preview;

      // What staff chose must still be possible: an invoice paid since the preview can no longer be replaced.
      for (const [id, choice] of Object.entries(dto.invoiceActions ?? {})) {
        const d = plan.documents.find((x) => x.id === id);
        if (d && d.action !== 'NONE' && d.action !== choice) {
          throw new ConflictException(`${d.label ?? 'An invoice'} changed since the preview (it can now only be ${d.action === 'CARRY' ? 'carried forward' : 'refreshed'}) - preview the correction again`);
        }
      }

      await this.writeRoster(t, booking, before.shifts, after, touched, actor);
      const summary = await this.applyToDocuments(t, booking, plan, documents, dto.reason.trim(), actor);
      const amendmentId = uuid();
      const adjustmentIds: BookingAmendmentSummary['adjustments'] = [];
      for (const a of plan.adjustments) {
        if (toCents(a.amount) === 0) continue;
        const id = uuid();
        await t.insert(billingAdjustments).values({
          id,
          side: a.side,
          patientId: a.patientId,
          caregiverId: a.caregiverId,
          bookingId,
          amendmentId,
          sourceLabel: a.sourceLabel,
          description: a.description.slice(0, 300),
          amount: a.amount,
          taxable: a.taxable,
          createdByUserId: actor.userId,
        });
        adjustmentIds.push({ id, side: a.side, amount: a.amount, partyName: a.partyName });
      }
      const stored: BookingAmendmentSummary = { changes, documents: summary, adjustments: adjustmentIds, issueIds: issues.map((i) => i.id) };
      await t.insert(bookingAmendments).values({ id: amendmentId, bookingId, reason: dto.reason.trim(), summary: JSON.stringify(stored), actorUserId: actor.userId });
      await this.bookingsService.event(t, bookingId, 'AMENDED', actor, historyNote(dto.reason.trim(), stored));

      if (dto.close) await this.closeBooking(t, bookingId, dto.close, dto.reason.trim(), actor);
      const now = new Date();
      for (const issue of issues) {
        await t
          .update(bookingIssueReports)
          .set({ status: 'RESOLVED', amendmentId, resolutionNote: dto.reply?.trim() || null, closedByUserId: actor.userId, closedAt: now })
          .where(eq(bookingIssueReports.id, issue.id));
      }
      if (issues.length) await this.bookingsService.event(t, bookingId, 'ISSUE_CLOSED', actor, `${issues.length} report${issues.length === 1 ? '' : 's'} resolved by this correction`);

      return noticesFor(booking, plan, documents, dto.close ?? null, issues.map((i) => i.id));
    }, CHECKED);
  }

  /** The open reports the correction says it answers - each must be on this booking and still open. */
  private async openIssues(t: Tx, bookingId: string, ids: string[]) {
    if (!ids.length) return [];
    const rows = await t.select({ id: bookingIssueReports.id, bookingId: bookingIssueReports.bookingId, status: bookingIssueReports.status }).from(bookingIssueReports).where(inArray(bookingIssueReports.id, [...new Set(ids)]));
    if (rows.length !== new Set(ids).size || rows.some((r) => r.bookingId !== bookingId)) throw new NotFoundException('Report not found');
    if (rows.some((r) => r.status !== 'OPEN')) throw new ConflictException('One of these reports is already closed - reload and try again');
    return rows;
  }

  /** The booking's own close, as Mark completed / Cancel booking do it - after the correction has dealt with the upcoming shifts. */
  private async closeBooking(t: Tx, bookingId: string, close: 'COMPLETED' | 'CANCELLED', reason: string, actor: AuthenticatedUser) {
    const now = new Date();
    if (close === 'COMPLETED') {
      await t.update(bookings).set({ status: 'COMPLETED', completedAt: now, updatedAt: now }).where(eq(bookings.id, bookingId));
      await this.bookingsService.event(t, bookingId, 'COMPLETED', actor);
    } else {
      await t.update(bookings).set({ status: 'CANCELLED', cancelledAt: now, cancelReason: reason.slice(0, 500), updatedAt: now }).where(eq(bookings.id, bookingId));
      await this.bookingsService.event(t, bookingId, 'CANCELLED', actor, reason);
    }
  }

  /** The booking and its shifts as the correction would leave them - validated like any roster edit. */
  private async corrected(t: Tx, booking: BookingRow, shiftRows: ShiftRow[], dto: AmendBookingDto) {
    const now = new Date();
    const next: PlanBooking = toPlanBooking(booking);
    if (dto.rateAmount !== undefined) {
      if (!booking.rateType) throw new BadRequestException('This booking has no agreed rate to correct');
      next.rateAmount = money(dto.rateAmount);
    }
    if (dto.payRateAmount !== undefined) {
      if (!booking.payRateType) throw new BadRequestException('This booking has no pay rate to correct');
      next.payRateAmount = money(dto.payRateAmount);
    }
    const rateBooking = { rateType: booking.rateType, payRateType: booking.payRateType, caregiverId: booking.caregiverId };

    const listed = (dto.shifts ?? []).map((s) => s.shiftId);
    if (new Set(listed).size !== listed.length) throw new BadRequestException('A shift is listed twice - put all its changes in one');
    const refs = await this.bookingsService.billingRefs(listed, t);
    const changed = new Map<string, PlanShift>();
    for (const c of dto.shifts ?? []) {
      const s = shiftRows.find((x) => x.id === c.shiftId);
      if (!s) throw new NotFoundException('Shift not found');
      const day = isoLocal(new Date(s.startsAt)).slice(0, 10);
      if (s.status === 'DRAFT') throw new BadRequestException('Draft shifts are edited on the roster');
      const onDocument = refs.invoices.has(s.id) || refs.payouts.has(s.id);
      if (new Date(s.startsAt) > now && !onDocument) {
        throw new BadRequestException(`The shift on ${day} has not happened and is not billed - change it on the roster instead`);
      }
      let startsAt = new Date(s.startsAt);
      let endsAt = new Date(s.endsAt);
      if (c.start || c.end) ({ startsAt, endsAt } = this.bookingsService.parseRange(c.start ?? isoLocal(startsAt), c.end ?? isoLocal(endsAt)));
      const started = startsAt <= now;
      let status: ShiftStatus = c.status ?? s.status;
      if (c.status) {
        if (started && c.status !== 'COMPLETED' && c.status !== 'MISSED') throw new BadRequestException(`The shift on ${day} has started - it was either done or missed`);
        if (!started && c.status !== 'SCHEDULED' && c.status !== 'CANCELLED') throw new BadRequestException(`The shift on ${day} has not started yet - it can only be scheduled or cancelled`);
      } else if (status === 'MISSED' && !started) {
        status = 'SCHEDULED';
      }
      const caregiverId = c.caregiverId ? await this.bookingsService.liveCaregiver(c.caregiverId, t) : s.caregiverId;
      const rates = this.bookingsService.resolveShiftRates(rateBooking, caregiverId, c, s);
      changed.set(s.id, {
        ...toPlanShift(s),
        startsAt,
        endsAt,
        status,
        caregiverId,
        ...rates,
        note: c.note !== undefined ? c.note?.trim() || null : s.note,
      });
    }

    const added: PlanShift[] = [];
    for (const a of dto.addShifts ?? []) {
      const { startsAt, endsAt } = this.bookingsService.parseRange(a.start, a.end);
      if (startsAt > now) throw new BadRequestException('Only shifts that already happened are added here - add upcoming ones on the roster');
      const caregiverId = a.caregiverId ? await this.bookingsService.liveCaregiver(a.caregiverId, t) : booking.caregiverId;
      const rates = this.bookingsService.resolveShiftRates(rateBooking, caregiverId, a, null);
      added.push({ id: uuid(), bookingId: booking.id, caregiverId, startsAt, endsAt, status: 'COMPLETED', ...rates, note: a.note?.trim() || null });
    }

    // Closing the booking: every upcoming scheduled shift not otherwise corrected is cancelled.
    const closing: string[] = [];
    if (dto.close) {
      for (const s of shiftRows) {
        if (changed.has(s.id) || s.status !== 'SCHEDULED' || new Date(s.startsAt) <= now) continue;
        changed.set(s.id, { ...toPlanShift(s), status: 'CANCELLED' });
        closing.push(s.id);
      }
    }

    const shifts = [...shiftRows.map((s) => changed.get(s.id) ?? toPlanShift(s)), ...added];
    return { booking: next, shifts, added, closing };
  }

  /**
   * Every live invoice and pay statement with a line for this booking - with
   * all of its lines, since a replaced invoice is copied whole.
   */
  private async documentsFor(t: Tx, booking: BookingRow): Promise<PlanDocument[]> {
    const invoiceIds = (
      await t
        .selectDistinct({ id: invoices.id })
        .from(invoiceLines)
        .innerJoin(invoices, eq(invoiceLines.invoiceId, invoices.id))
        .where(and(eq(invoiceLines.bookingId, booking.id), eq(invoiceLines.kind, 'SHIFT'), ne(invoices.status, 'VOID')))
    ).map((r) => r.id);
    const statementIds = (
      await t
        .selectDistinct({ id: payoutStatements.id })
        .from(payoutLines)
        .innerJoin(payoutStatements, eq(payoutLines.statementId, payoutStatements.id))
        .where(and(eq(payoutLines.bookingId, booking.id), eq(payoutLines.kind, 'SHIFT'), ne(payoutStatements.status, 'VOID')))
    ).map((r) => r.id);

    const docs: PlanDocument[] = [];
    if (invoiceIds.length) {
      // Locked in id order, so two corrections touching the same invoices cannot deadlock.
      await t.execute(sql`SELECT id FROM invoices WHERE id IN (${sql.join([...invoiceIds].sort().map((i) => sql`${i}`), sql`, `)}) FOR UPDATE`);
      const [rows, lines, [client]] = await Promise.all([
        t.select().from(invoices).where(inArray(invoices.id, invoiceIds)),
        t.select().from(invoiceLines).where(inArray(invoiceLines.invoiceId, invoiceIds)).orderBy(asc(invoiceLines.position)),
        t.select({ fullName: patients.fullName }).from(patients).where(eq(patients.id, booking.patientId)).limit(1),
      ]);
      for (const inv of rows.filter((r) => r.status !== 'VOID')) {
        docs.push({
          kind: 'INVOICE',
          id: inv.id,
          label: inv.number,
          status: inv.status,
          basis: inv.basis,
          language: inv.language,
          amountPaid: inv.amountPaid,
          discountType: inv.discountType,
          discountValue: inv.discountValue,
          taxRate: inv.taxRate,
          partyName: inv.billToName ?? client?.fullName ?? null,
          lines: lines.filter((l) => l.invoiceId === inv.id) as PlanLine[],
        });
      }
    }
    if (statementIds.length) {
      await t.execute(sql`SELECT id FROM payout_statements WHERE id IN (${sql.join([...statementIds].sort().map((i) => sql`${i}`), sql`, `)}) FOR UPDATE`);
      const [rows, lines] = await Promise.all([
        t
          .select({ s: payoutStatements, caregiver: caregivers.fullName })
          .from(payoutStatements)
          .innerJoin(caregivers, eq(payoutStatements.caregiverId, caregivers.id))
          .where(inArray(payoutStatements.id, statementIds)),
        t.select().from(payoutLines).where(inArray(payoutLines.statementId, statementIds)).orderBy(asc(payoutLines.position)),
      ]);
      for (const { s, caregiver } of rows.filter((r) => r.s.status !== 'VOID')) {
        docs.push({
          kind: 'PAYOUT',
          id: s.id,
          label: s.reference,
          status: s.status,
          caregiverId: s.caregiverId,
          language: 'en',
          partyName: caregiver,
          lines: lines.filter((l) => l.statementId === s.id) as PlanLine[],
        });
      }
    }
    return docs;
  }

  private async writeRoster(t: Tx, booking: BookingRow, before: PlanShift[], after: { booking: PlanBooking; shifts: PlanShift[]; added: PlanShift[] }, touched: Set<string>, actor: AuthenticatedUser) {
    const now = new Date();
    if (after.booking.rateAmount !== booking.rateAmount || after.booking.payRateAmount !== booking.payRateAmount) {
      await t.update(bookings).set({ rateAmount: after.booking.rateAmount, payRateAmount: after.booking.payRateAmount, updatedAt: now }).where(eq(bookings.id, booking.id));
    }
    const addedIds = new Set(after.added.map((s) => s.id));
    for (const s of after.shifts) {
      if (!touched.has(s.id)) continue;
      const values = {
        caregiverId: s.caregiverId,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        status: s.status,
        note: s.note ?? null,
        rateType: s.rateType,
        rateAmount: s.rateAmount,
        payRateType: s.payRateType,
        payRateAmount: s.payRateAmount,
        updatedByUserId: actor.userId,
      };
      if (addedIds.has(s.id)) {
        await t.insert(bookingShifts).values({ id: s.id, bookingId: booking.id, ...values });
        continue;
      }
      const old = before.find((o) => o.id === s.id)!;
      const same =
        old.caregiverId === s.caregiverId &&
        old.startsAt.getTime() === s.startsAt.getTime() &&
        old.endsAt.getTime() === s.endsAt.getTime() &&
        old.status === s.status &&
        (old.note ?? null) === (s.note ?? null) &&
        old.rateType === s.rateType &&
        old.rateAmount === s.rateAmount &&
        old.payRateType === s.payRateType &&
        old.payRateAmount === s.payRateAmount;
      if (!same) await t.update(bookingShifts).set({ ...values, updatedAt: now }).where(eq(bookingShifts.id, s.id));
    }
  }

  private async applyToDocuments(t: Tx, booking: BookingRow, plan: AmendmentPlan, docs: PlanDocument[], reason: string, actor: AuthenticatedUser) {
    const out: BookingAmendmentSummary['documents'] = [];
    for (const d of plan.documents) {
      const doc = docs.find((x) => x.id === d.id)!;
      const entry: BookingAmendmentSummary['documents'][number] = { kind: d.kind, id: d.id, label: d.label, action: d.action, difference: d.difference };
      out.push(entry);
      const note = `Booking ${booking.reference} corrected: ${reason}`;

      if (d.kind === 'INVOICE') {
        if (d.action === 'REFRESH') {
          await refreshLines(t, 'INVOICE', d.rebuilt);
          await this.invoicesService.recalc(t, d.id);
          await this.invoicesService.event(t, d.id, 'LINES_CHANGED', actor, note);
        } else if (d.action === 'REPLACE') {
          const inv = await this.invoicesService.invoiceOrThrow(d.id, t, true);
          await this.invoicesService.voidIn(t, d.id, `Replaced after a correction to ${booking.reference}: ${reason}`.slice(0, 500), actor);
          const lines = (doc.lines as (PlanLine & { taxable?: boolean })[])
            .map((l): StoredLine | null => {
              if (!d.rebuilt.has(l.id)) return l as StoredLine;
              const next = d.rebuilt.get(l.id);
              return next ? ({ ...l, ...next } as StoredLine) : null;
            })
            .filter((l): l is StoredLine => l !== null);
          entry.replacementId = await this.invoicesService.copyAsDraftIn(t, inv, lines, actor, `Corrected copy of ${inv.number ?? 'an invoice'} - ${note}`.slice(0, 1000));
        } else if (d.action === 'CARRY') {
          await this.invoicesService.event(t, d.id, 'NOTE', actor, `${note}. ${formatLkr(d.difference)} carried to the next invoice; this invoice is unchanged.`);
        }
      } else {
        if (d.action === 'REOPEN') await this.payoutsService.reopenIn(t, d.id);
        if (d.action === 'REOPEN' || d.action === 'REFRESH') {
          await refreshLines(t, 'PAYOUT', d.rebuilt);
          await this.payoutsService.recalc(t, d.id);
        }
      }
    }
    return out;
  }
}

/** A draft's touched lines rewritten in place (or removed): same id and position, new quantity, price and words. */
async function refreshLines(t: Tx, kind: 'INVOICE' | 'PAYOUT', rebuilt: Map<string, RebuiltLine>) {
  const table = kind === 'INVOICE' ? invoiceLines : payoutLines;
  for (const [id, next] of rebuilt) {
    if (next === null) {
      await t.delete(table).where(eq(table.id, id));
      continue;
    }
    await t
      .update(table)
      .set({
        description: next.description,
        serviceDate: next.serviceDate,
        quantity: next.quantity,
        unit: next.unit,
        unitPrice: next.unitPrice,
        amount: next.amount,
        caregiverId: next.caregiverId,
      })
      .where(eq(table.id, id));
  }
}

function toPlanBooking(b: BookingRow): PlanBooking {
  return {
    id: b.id,
    reference: b.reference,
    patientId: b.patientId,
    caregiverId: b.caregiverId,
    startDate: b.startDate,
    endDate: b.endDate,
    rateType: b.rateType,
    rateAmount: b.rateAmount,
    payRateType: b.payRateType,
    payRateAmount: b.payRateAmount,
  };
}

function toPlanShift(s: ShiftRow): PlanShift {
  return {
    id: s.id,
    bookingId: s.bookingId,
    caregiverId: s.caregiverId,
    startsAt: new Date(s.startsAt),
    endsAt: new Date(s.endsAt),
    status: s.status,
    rateType: s.rateType,
    rateAmount: s.rateAmount,
    payRateType: s.payRateType,
    payRateAmount: s.payRateAmount,
    note: s.note,
  };
}

/**
 * Who hears about a correction once it is committed. Only what they have
 * seen and what touches their money: an issued or paid invoice replaced or
 * carried (the client), an approved or paid statement reopened or carried, or
 * pay owed for a shift they turned out to have worked (the caregiver) - plus a
 * cancelled booking, and the reports it resolved. Drafts change silently.
 */
function noticesFor(booking: BookingRow, plan: AmendmentPlan, docs: PlanDocument[], close: 'COMPLETED' | 'CANCELLED' | null, issueIds: string[]): CorrectionNotices {
  const seen = new Map(docs.map((d) => [d.id, d]));
  const client: CorrectionNotices['client'] = [];
  const caregivers = new Map<string, CorrectionNotices['caregivers'][number]['items']>();
  const pay = (id: string) => caregivers.get(id) ?? caregivers.set(id, []).get(id)!;
  for (const d of plan.documents) {
    if (d.kind === 'INVOICE' && d.action === 'REPLACE') client.push({ action: 'REPLACE', label: d.label, amount: d.difference });
    if (d.kind === 'PAYOUT' && d.action === 'REOPEN') {
      const cg = seen.get(d.id)?.caregiverId;
      if (cg) pay(cg).push({ action: 'REOPEN', label: d.label, amount: d.difference });
    }
  }
  for (const a of plan.adjustments) {
    if (toCents(a.amount) === 0) continue;
    if (a.side === 'CLIENT') client.push({ action: 'CARRY', label: a.sourceLabel, amount: a.amount });
    else if (a.caregiverId) pay(a.caregiverId).push({ action: 'CARRY', label: a.sourceLabel, amount: a.amount });
  }
  return {
    bookingId: booking.id,
    reference: booking.reference,
    language: booking.language,
    patientId: booking.patientId,
    client,
    caregivers: [...caregivers].map(([caregiverId, items]) => ({ caregiverId, items })),
    cancelled: close === 'CANCELLED',
    issueIds,
  };
}

/** The AMENDED history entry: the reason, then what changed and what it did to the documents. */
function historyNote(reason: string, s: BookingAmendmentSummary) {
  const action: Record<string, string> = {
    REFRESH: 'draft updated',
    REPLACE: 'voided and replaced by a corrected draft',
    CARRY: 'difference carried forward',
    REOPEN: 'sent back to draft and updated',
    NONE: 'unchanged',
  };
  const lines = [
    reason,
    ...s.changes.map((c) => `• ${c.date ? `${c.date}: ` : ''}${c.changes.join('; ')}`),
    ...s.documents.map((d) => `• ${d.kind === 'INVOICE' ? (d.label ? `Invoice ${d.label}` : 'Draft invoice') : `Pay statement ${d.label}`}: ${action[d.action]} (${formatLkr(d.difference)})`),
  ];
  return lines.join('\n');
}
