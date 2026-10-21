import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID as uuid } from 'crypto';
import { and, count, desc, eq, inArray, sql } from 'drizzle-orm';
import { CAREGIVER_ISSUE_CATEGORIES, CLIENT_ISSUE_CATEGORIES, type IssueReportView, type MyIssueReport } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { bookingIssueReports, bookings, bookingShifts, caregivers, patients, users, type CareRequestLanguage } from '../database/schema';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { BookingsService } from '../bookings/bookings.service';
import { CorrectionsNotifier } from './corrections-notifier.service';
import type { CloseIssueReportDto, CreateIssueReportDto } from './dto/amend-booking.dto';

type Tx = Database;

/** Open reports one person may have waiting on one booking - enough for a real problem, not a flood. */
export const MAX_OPEN_REPORTS = 5;

/**
 * Clients and caregivers reporting that something on a booking is wrong. They
 * never change the booking themselves: a report waits on the booking for staff,
 * who answer it with a correction (which resolves it) or close it with a note.
 *
 * A client reports on their own booking - optionally one shift of it - and a
 * caregiver on a shift they hold (booked or covering). Neither sees the other's
 * reports, and neither sees staff's internal notes, only the answer meant for them.
 */
@Injectable()
export class IssueReportsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly bookingsService: BookingsService,
    private readonly notifier: CorrectionsNotifier,
  ) {}

  async createForClient(user: AuthenticatedUser, bookingId: string, dto: CreateIssueReportDto, lang: CareRequestLanguage): Promise<MyIssueReport> {
    if (user.role !== 'PATIENT_GUARDIAN' || !user.patientId) throw new ForbiddenException('You do not have permission to perform this action');
    if (!CLIENT_ISSUE_CATEGORIES.includes(dto.category)) throw new BadRequestException('Choose what is wrong');
    const [b] = await this.db.select({ id: bookings.id, patientId: bookings.patientId, status: bookings.status }).from(bookings).where(eq(bookings.id, bookingId)).limit(1);
    // Someone else's booking, or a draft they cannot see, reads as not found.
    if (!b || b.patientId !== user.patientId || b.status === 'DRAFT') throw new NotFoundException('Booking not found');
    if (dto.shiftId) {
      const [s] = await this.db.select({ bookingId: bookingShifts.bookingId, status: bookingShifts.status }).from(bookingShifts).where(eq(bookingShifts.id, dto.shiftId)).limit(1);
      if (!s || s.bookingId !== b.id || s.status === 'DRAFT') throw new NotFoundException('Shift not found');
    }
    return this.create({ bookingId: b.id, shiftId: dto.shiftId ?? null, role: 'CLIENT', caregiverId: null, user, dto, lang });
  }

  async createForCaregiver(user: AuthenticatedUser, shiftId: string, dto: CreateIssueReportDto, lang: CareRequestLanguage): Promise<MyIssueReport> {
    if (user.role !== 'CAREGIVER' || !user.caregiverId) throw new ForbiddenException('You do not have permission to perform this action');
    if (!CAREGIVER_ISSUE_CATEGORIES.includes(dto.category)) throw new BadRequestException('Choose what is wrong');
    const [s] = await this.db
      .select({ bookingId: bookingShifts.bookingId, caregiverId: bookingShifts.caregiverId, status: bookingShifts.status, bookingStatus: bookings.status })
      .from(bookingShifts)
      .innerJoin(bookings, eq(bookingShifts.bookingId, bookings.id))
      .where(eq(bookingShifts.id, shiftId))
      .limit(1);
    if (!s || s.caregiverId !== user.caregiverId || s.status === 'DRAFT' || s.bookingStatus === 'DRAFT') throw new NotFoundException('Shift not found');
    return this.create({ bookingId: s.bookingId, shiftId, role: 'CAREGIVER', caregiverId: user.caregiverId, user, dto, lang });
  }

  private async create(p: {
    bookingId: string;
    shiftId: string | null;
    role: 'CLIENT' | 'CAREGIVER';
    caregiverId: string | null;
    user: AuthenticatedUser;
    dto: CreateIssueReportDto;
    lang: CareRequestLanguage;
  }): Promise<MyIssueReport> {
    const message = p.dto.message?.trim();
    if (!message || message.length < 5) throw new BadRequestException('Tell us what is wrong');
    const id = uuid();
    await this.db.transaction(async (tx) => {
      const t = tx as unknown as Tx;
      // One report at a time per booking, so the open-report limit holds under double clicks.
      await t.execute(sql`SELECT id FROM bookings WHERE id = ${p.bookingId} FOR UPDATE`);
      const [{ open }] = await t
        .select({ open: count() })
        .from(bookingIssueReports)
        .where(and(eq(bookingIssueReports.bookingId, p.bookingId), eq(bookingIssueReports.reporterUserId, p.user.userId), eq(bookingIssueReports.status, 'OPEN')));
      if (open >= MAX_OPEN_REPORTS) throw new ConflictException('You already have several reports waiting on this booking - our team will get back to you');
      await t.insert(bookingIssueReports).values({
        id,
        bookingId: p.bookingId,
        shiftId: p.shiftId,
        reporterUserId: p.user.userId,
        reporterRole: p.role,
        caregiverId: p.caregiverId,
        category: p.dto.category,
        message,
        language: p.lang,
      });
      await this.bookingsService.event(t, p.bookingId, 'ISSUE_REPORTED', null, `${p.role === 'CLIENT' ? 'Client' : 'Caregiver'}: ${message.slice(0, 300)}`);
    });
    void this.notifier.issueReported(id);
    const [mine] = await this.listMine(p.user, [id]);
    return mine;
  }

  /** The reporter's own reports, newest first (or just the given ones). */
  async listMine(user: AuthenticatedUser, only?: string[]): Promise<MyIssueReport[]> {
    if (user.role !== 'PATIENT_GUARDIAN' && user.role !== 'CAREGIVER') throw new ForbiddenException('You do not have permission to perform this action');
    const rows = await this.rows(only ? and(eq(bookingIssueReports.reporterUserId, user.userId), inArray(bookingIssueReports.id, only)) : eq(bookingIssueReports.reporterUserId, user.userId), 100);
    return rows.map(({ r, reference, startsAt }) => this.mine(r, reference, startsAt));
  }

  /** Every report on a booking, for staff, newest first. */
  async listForBooking(bookingId: string): Promise<IssueReportView[]> {
    const rows = await this.rows(eq(bookingIssueReports.bookingId, bookingId), 200);
    const ids = [...new Set(rows.flatMap(({ r }) => [r.reporterUserId, r.closedByUserId]).filter((v): v is string => Boolean(v)))];
    const names = new Map(ids.length ? (await this.db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, ids))).map((u) => [u.id, u]) : []);
    // The client and caregiver as staff know them, rather than their account names.
    const cgIds = [...new Set(rows.map(({ r }) => r.caregiverId).filter((v): v is string => Boolean(v)))];
    const cgNames = new Map(cgIds.length ? (await this.db.select({ id: caregivers.id, fullName: caregivers.fullName }).from(caregivers).where(inArray(caregivers.id, cgIds))).map((c) => [c.id, c.fullName]) : []);
    const [client] = rows.length
      ? await this.db.select({ fullName: patients.fullName }).from(bookings).innerJoin(patients, eq(bookings.patientId, patients.id)).where(eq(bookings.id, bookingId)).limit(1)
      : [];
    return rows.map(({ r, reference, startsAt }) => ({
      ...this.mine(r, reference, startsAt),
      reporterRole: r.reporterRole,
      reporterName: (r.reporterRole === 'CLIENT' ? client?.fullName : r.caregiverId ? cgNames.get(r.caregiverId) : null) ?? names.get(r.reporterUserId)?.fullName ?? null,
      amendmentId: r.amendmentId,
      closedBy: r.closedByUserId ? (names.get(r.closedByUserId) ?? null) : null,
    }));
  }

  /** Staff answer a report without a correction: resolved another way, or nothing to change. */
  async close(id: string, dto: CloseIssueReportDto, actor: AuthenticatedUser): Promise<IssueReportView> {
    let bookingId = '';
    await this.db.transaction(async (tx) => {
      const t = tx as unknown as Tx;
      await t.execute(sql`SELECT id FROM booking_issue_reports WHERE id = ${id} FOR UPDATE`);
      const [r] = await t.select().from(bookingIssueReports).where(eq(bookingIssueReports.id, id)).limit(1);
      if (!r) throw new NotFoundException('Report not found');
      if (r.status !== 'OPEN') throw new ConflictException('This report is already closed');
      await t
        .update(bookingIssueReports)
        .set({ status: dto.status, resolutionNote: dto.note.trim(), closedByUserId: actor.userId, closedAt: new Date() })
        .where(eq(bookingIssueReports.id, id));
      await this.bookingsService.event(t, r.bookingId, 'ISSUE_CLOSED', actor, `${dto.status === 'RESOLVED' ? 'Resolved' : 'Dismissed'}: ${dto.note.trim()}`);
      bookingId = r.bookingId;
    });
    void this.notifier.issueClosed(id);
    return (await this.listForBooking(bookingId)).find((r) => r.id === id)!;
  }

  private rows(where: ReturnType<typeof eq> | ReturnType<typeof and>, limit: number) {
    return this.db
      .select({ r: bookingIssueReports, reference: bookings.reference, startsAt: bookingShifts.startsAt })
      .from(bookingIssueReports)
      .innerJoin(bookings, eq(bookingIssueReports.bookingId, bookings.id))
      .leftJoin(bookingShifts, eq(bookingIssueReports.shiftId, bookingShifts.id))
      .where(where)
      .orderBy(desc(bookingIssueReports.createdAt))
      .limit(limit);
  }

  private mine(r: typeof bookingIssueReports.$inferSelect, reference: string, startsAt: Date | null): MyIssueReport {
    return {
      id: r.id,
      bookingId: r.bookingId,
      bookingReference: reference,
      shiftId: r.shiftId,
      shiftStartsAt: startsAt ? new Date(startsAt).toISOString() : null,
      category: r.category,
      message: r.message,
      status: r.status,
      resolutionNote: r.resolutionNote,
      createdAt: new Date(r.createdAt).toISOString(),
      closedAt: r.closedAt ? new Date(r.closedAt).toISOString() : null,
    };
  }
}
