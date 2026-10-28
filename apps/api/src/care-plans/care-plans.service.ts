import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID as uuid } from 'crypto';
import { and, asc, desc, eq, gte, inArray, lt, ne, sql } from 'drizzle-orm';
import {
  CAREGIVER_PLAN_LEAD_HOURS,
  CARE_DUE_SHIFT_STATUSES,
  addDays,
  careCutOff,
  careOccurrences,
  colomboToUtc,
  colomboToday,
  isValidDate,
  pickText,
  shiftCareDate,
  type CareChecklistItem,
  type CareChecklistShift,
  type CareLogResponse,
  type CarePlanActivityView,
  type CarePlanResponse,
  type CareRecordSource,
  type CareType,
  type ClientCareDay,
  type Locale,
  type ShiftStatus,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  bookingEvents,
  bookingShifts,
  bookings,
  careActivityRecords,
  carePlanActivities,
  carePlans,
  careRequests,
  caregivers,
  patients,
  users,
  type BookingEventType,
} from '../database/schema';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { cleanActivities, fieldsToColumns, rowToFields, type ActivityRow } from './activity-rows';
import { activitiesInForce, earliestEditDate, planCarePlanEdit, type EditableActivity } from './plan-edit';
import { CarePlanTemplatesService } from './care-plan-templates.service';
import type { CareRecordDto, CreateCarePlanDto, UpdateCarePlanDto } from './dto/care-plan.dto';

type PlanActivityRow = typeof carePlanActivities.$inferSelect;
type RecordRow = typeof careActivityRecords.$inferSelect;

/** A shift with what its checklist needs about the booking and plan. */
interface ShiftContext {
  shiftId: string;
  bookingId: string;
  bookingReference: string;
  patientId: string;
  language: Locale;
  bookedCaregiverId: string;
  caregiverId: string;
  caregiverName: string | null;
  startsAt: Date;
  endsAt: Date;
  status: ShiftStatus;
  planId: string;
  planNotes: string | null;
}

type Viewer = 'STAFF' | 'CLIENT' | 'CAREGIVER';

/** Client day view: how far back and ahead a client may page. */
const CLIENT_DAYS_BACK = 60;
const CLIENT_DAYS_AHEAD = 14;
/** Staff care log: the default and the longest range. */
const LOG_DEFAULT_DAYS = 14;
const LOG_MAX_DAYS = 92;

const isDuplicate = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e.code ?? e.cause?.code) === 'ER_DUP_ENTRY';
};

/**
 * Care plans on bookings, and the checklists built from them.
 *
 * Staff create a booking's plan (from a template, from the client's earlier
 * plan, or blank) and change it from a date. The client marks what was done
 * on each shift until its cut-off; the caregiver reads the plan for the
 * shifts they work. CarePlanSweepService fills in what nobody marked.
 */
@Injectable()
export class CarePlansService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly templates: CarePlanTemplatesService,
  ) {}

  // --- staff: the plan --------------------------------------------------------------

  private async bookingOrThrow(id: string) {
    const [row] = await this.db.select().from(bookings).where(eq(bookings.id, id)).limit(1);
    if (!row) throw new NotFoundException('Booking not found');
    return row;
  }

  private async planFor(bookingId: string) {
    const [plan] = await this.db.select().from(carePlans).where(eq(carePlans.bookingId, bookingId)).limit(1);
    return plan ?? null;
  }

  private async planActivities(planIds: string[]): Promise<PlanActivityRow[]> {
    if (!planIds.length) return [];
    return this.db.select().from(carePlanActivities).where(inArray(carePlanActivities.planId, planIds)).orderBy(asc(carePlanActivities.sortOrder));
  }

  private static view(r: PlanActivityRow): CarePlanActivityView {
    return {
      id: r.id,
      sortOrder: r.sortOrder,
      ...rowToFields(r as unknown as ActivityRow),
      effectiveFrom: r.effectiveFrom,
      effectiveTo: r.effectiveTo,
      replacesActivityId: r.replacesActivityId,
    };
  }

  async getPlan(bookingId: string): Promise<CarePlanResponse> {
    const booking = await this.bookingOrThrow(bookingId);
    const today = colomboToday();
    const plan = await this.planFor(bookingId);
    const rows = plan ? await this.planActivities([plan.id]) : [];
    const minEffectiveFrom = earliestEditDate(rows, today);
    const inForceOn = minEffectiveFrom;
    const tomorrow = addDays(today, 1);
    const suggested = [tomorrow, booking.startDate, minEffectiveFrom].reduce((a, b) => (b > a ? b : a));

    const [request] = booking.careRequestId
      ? await this.db.select({ careType: careRequests.careType }).from(careRequests).where(eq(careRequests.id, booking.careRequestId)).limit(1)
      : [];
    const copyable = await this.db
      .select({ id: bookings.id, reference: bookings.reference, startDate: bookings.startDate })
      .from(bookings)
      .innerJoin(carePlans, eq(carePlans.bookingId, bookings.id))
      .where(and(eq(bookings.patientId, booking.patientId), ne(bookings.id, bookingId)))
      .orderBy(desc(bookings.startDate))
      .limit(10);

    const live = rows.filter((r) => !r.effectiveTo || r.effectiveTo >= r.effectiveFrom);
    const current = activitiesInForce(live, inForceOn);
    const currentIds = new Set(current.map((r) => r.id));
    return {
      plan: plan
        ? {
            id: plan.id,
            bookingId,
            sourceTemplate: plan.sourceTemplateId && plan.sourceTemplateName ? { id: plan.sourceTemplateId, name: plan.sourceTemplateName } : null,
            notes: plan.notes,
            activities: current.map(CarePlansService.view),
            history: rows
              .filter((r) => !currentIds.has(r.id) && r.effectiveTo && r.effectiveTo >= r.effectiveFrom)
              .sort((a, b) => (b.effectiveTo ?? '').localeCompare(a.effectiveTo ?? '') || a.sortOrder - b.sortOrder)
              .map(CarePlansService.view),
            createdAt: new Date(plan.createdAt).toISOString(),
            updatedAt: new Date(plan.updatedAt).toISOString(),
          }
        : null,
      today,
      inForceOn,
      minEffectiveFrom,
      suggestedEffectiveFrom: suggested,
      careType: (request?.careType as CareType | null | undefined) ?? null,
      copyableBookings: copyable,
    };
  }

  private async event(db: Database, bookingId: string, type: BookingEventType, actor: AuthenticatedUser, note: string) {
    await db.insert(bookingEvents).values({ id: uuid(), bookingId, type, note, actorUserId: actor.userId });
  }

  /** A plan for a booking that has none: a template's activities, another plan's current ones, or nothing yet. */
  async createPlan(bookingId: string, dto: CreateCarePlanDto, actor: AuthenticatedUser): Promise<CarePlanResponse> {
    const booking = await this.bookingOrThrow(bookingId);
    if (booking.status !== 'DRAFT' && booking.status !== 'CONFIRMED') throw new BadRequestException('This booking is closed and can no longer be changed');
    if (dto.templateId && dto.fromBookingId) throw new BadRequestException('Start from a template or another plan, not both');
    if (await this.planFor(bookingId)) throw new ConflictException('This booking already has a care plan');

    const today = colomboToday();
    const from = booking.startDate > today ? booking.startDate : today;
    let source: { id: string | null; name: string | null; notes: string | null; activities: ReturnType<typeof rowToFields>[] } = { id: null, name: null, notes: null, activities: [] };
    let note = 'Care plan started blank';

    if (dto.templateId) {
      const t = await this.templates.get(dto.templateId);
      if (t.status !== 'ACTIVE') throw new BadRequestException('That template is archived');
      source = { id: t.id, name: t.name, notes: null, activities: t.activities.map(({ id: _i, sortOrder: _s, ...a }) => a) };
      note = `Care plan from template "${t.name}"`;
    } else if (dto.fromBookingId) {
      const other = await this.bookingOrThrow(dto.fromBookingId);
      if (other.patientId !== booking.patientId) throw new BadRequestException('Copy a plan from one of the same client\'s bookings');
      const otherPlan = await this.planFor(other.id);
      if (!otherPlan) throw new NotFoundException('That booking has no care plan');
      const rows = await this.planActivities([otherPlan.id]);
      const latest = earliestEditDate(rows, today);
      source = {
        id: otherPlan.sourceTemplateId,
        name: otherPlan.sourceTemplateName,
        notes: otherPlan.notes,
        activities: activitiesInForce(rows, latest).map((r) => rowToFields(r as unknown as ActivityRow)),
      };
      note = `Care plan copied from booking ${other.reference}`;
    }

    const planId = uuid();
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(carePlans).values({
          id: planId,
          bookingId,
          sourceTemplateId: source.id,
          sourceTemplateName: source.name,
          notes: source.notes,
          createdByUserId: actor.userId,
          updatedByUserId: actor.userId,
        });
        if (source.activities.length) {
          await tx
            .insert(carePlanActivities)
            .values(source.activities.map((a, i) => ({ id: uuid(), planId, sortOrder: i, effectiveFrom: from, ...fieldsToColumns(a) })));
        }
        await this.event(tx as unknown as Database, bookingId, 'CARE_PLAN_SET', actor, note);
      });
    } catch (err) {
      if (isDuplicate(err)) throw new ConflictException('This booking already has a care plan');
      throw err;
    }
    return this.getPlan(bookingId);
  }

  /** The plan as it should read from `effectiveFrom` on; earlier days keep what was due then. */
  async updatePlan(bookingId: string, dto: UpdateCarePlanDto, actor: AuthenticatedUser): Promise<CarePlanResponse> {
    const booking = await this.bookingOrThrow(bookingId);
    if (booking.status !== 'DRAFT' && booking.status !== 'CONFIRMED') throw new BadRequestException('This booking is closed and can no longer be changed');
    const plan = await this.planFor(bookingId);
    if (!plan) throw new NotFoundException('This booking has no care plan yet');
    if (!isValidDate(dto.effectiveFrom)) throw new BadRequestException('Choose the date the change takes effect');

    const today = colomboToday();
    const rows = await this.planActivities([plan.id]);
    const min = earliestEditDate(rows, today);
    if (dto.effectiveFrom < min) throw new BadRequestException(`Changes can take effect from ${min} at the earliest`);
    const incoming = cleanActivities(dto.activities);

    const recorded = new Set(
      rows.length
        ? (
            await this.db
              .selectDistinct({ id: careActivityRecords.planActivityId })
              .from(careActivityRecords)
              .where(inArray(careActivityRecords.planActivityId, rows.map((r) => r.id)))
          ).map((r) => r.id)
        : [],
    );
    const editable: EditableActivity[] = rows
      .filter((r) => !r.effectiveTo || r.effectiveTo >= r.effectiveFrom)
      .map((r) => ({
        id: r.id,
        sortOrder: r.sortOrder,
        effectiveFrom: r.effectiveFrom,
        effectiveTo: r.effectiveTo,
        hasRecords: recorded.has(r.id),
        ...rowToFields(r as unknown as ActivityRow),
      }));
    const edit = planCarePlanEdit(editable, incoming, dto.effectiveFrom);
    const notesChanged = dto.notes !== undefined && (dto.notes ?? null) !== (plan.notes ?? null);
    const changed = edit.close.length + edit.remove.length + edit.insert.length + edit.update.length > 0;
    if (!changed && !notesChanged) return this.getPlan(bookingId);

    await this.db.transaction(async (tx) => {
      for (const u of edit.update) {
        await tx.update(carePlanActivities).set({ sortOrder: u.sortOrder, ...fieldsToColumns(u.fields) }).where(eq(carePlanActivities.id, u.id));
      }
      for (const c of edit.close) {
        await tx.update(carePlanActivities).set({ effectiveTo: c.effectiveTo }).where(eq(carePlanActivities.id, c.id));
      }
      if (edit.remove.length) await tx.delete(carePlanActivities).where(inArray(carePlanActivities.id, edit.remove));
      if (edit.insert.length) {
        await tx.insert(carePlanActivities).values(
          edit.insert.map((i) => ({
            id: uuid(),
            planId: plan.id,
            sortOrder: i.sortOrder,
            effectiveFrom: dto.effectiveFrom,
            replacesActivityId: i.replaces,
            ...fieldsToColumns(i.fields),
          })),
        );
      }
      await tx
        .update(carePlans)
        .set({ ...(notesChanged ? { notes: dto.notes ?? null } : {}), updatedByUserId: actor.userId, updatedAt: new Date() })
        .where(eq(carePlans.id, plan.id));
      const replaced = new Set(edit.insert.map((i) => i.replaces).filter(Boolean));
      const added = edit.insert.filter((i) => !i.replaces).length;
      const changedCount = replaced.size + edit.update.filter((u) => u.contentChanged).length;
      const removed = edit.close.filter((c) => !replaced.has(c.id)).length + edit.remove.length;
      const parts = [
        added ? `${added} added` : null,
        changedCount ? `${changedCount} changed` : null,
        removed ? `${removed} removed` : null,
        notesChanged ? 'notes changed' : null,
      ].filter(Boolean);
      await this.event(tx as unknown as Database, bookingId, 'CARE_PLAN_CHANGED', actor, `From ${dto.effectiveFrom}: ${parts.join(', ') || 'order changed'}`);
    });
    return this.getPlan(bookingId);
  }

  /** The plan's current activities as a new template. */
  async saveAsTemplate(bookingId: string, name: string, actor: AuthenticatedUser) {
    const res = await this.getPlan(bookingId);
    if (!res.plan) throw new NotFoundException('This booking has no care plan yet');
    return this.templates.createFrom(
      name,
      res.careType ? [res.careType] : [],
      res.plan.activities.map(({ id: _i, sortOrder: _s, effectiveFrom: _f, effectiveTo: _t, replacesActivityId: _r, ...a }) => a),
      actor,
    );
  }

  // --- checklists ----------------------------------------------------------------------

  /** Shifts on bookings that have a plan, matching `where`, with their booking and plan. */
  private async shiftContexts(where: ReturnType<typeof and>, limit = 400): Promise<ShiftContext[]> {
    const rows = await this.db
      .select({
        shiftId: bookingShifts.id,
        bookingId: bookings.id,
        bookingReference: bookings.reference,
        patientId: bookings.patientId,
        language: bookings.language,
        bookedCaregiverId: bookings.caregiverId,
        caregiverId: bookingShifts.caregiverId,
        caregiverName: caregivers.fullName,
        startsAt: bookingShifts.startsAt,
        endsAt: bookingShifts.endsAt,
        status: bookingShifts.status,
        planId: carePlans.id,
        planNotes: carePlans.notes,
      })
      .from(bookingShifts)
      .innerJoin(bookings, eq(bookingShifts.bookingId, bookings.id))
      .innerJoin(carePlans, eq(carePlans.bookingId, bookings.id))
      .leftJoin(caregivers, eq(caregivers.id, bookingShifts.caregiverId))
      .where(and(where, inArray(bookingShifts.status, [...CARE_DUE_SHIFT_STATUSES]), ne(bookings.status, 'DRAFT')))
      .orderBy(asc(bookingShifts.startsAt))
      .limit(limit);
    return rows.map((r) => ({ ...r, startsAt: new Date(r.startsAt), endsAt: new Date(r.endsAt) }));
  }

  private async checklists(shifts: ShiftContext[], viewer: Viewer, locale: Locale, now = new Date()): Promise<CareChecklistShift[]> {
    if (!shifts.length) return [];
    const activities = await this.planActivities([...new Set(shifts.map((s) => s.planId))]);
    const records: RecordRow[] = await this.db
      .select()
      .from(careActivityRecords)
      .where(inArray(careActivityRecords.shiftId, shifts.map((s) => s.shiftId)));
    const names = viewer === 'STAFF' ? await this.userNames(records.map((r) => r.recordedByUserId)) : new Map<string, string>();
    const byId = new Map(activities.map((a) => [a.id, a]));

    return shifts.map((s) => {
      const planActs = activities.filter((a) => a.planId === s.planId);
      const occ = careOccurrences(
        planActs.map((a) => ({ ...rowToFields(a as unknown as ActivityRow), id: a.id, sortOrder: a.sortOrder, effectiveFrom: a.effectiveFrom, effectiveTo: a.effectiveTo })),
        s,
      );
      const cutOff = careCutOff(s.endsAt);
      const locked = now >= cutOff;
      const items: CareChecklistItem[] = occ.map((o) => {
        const a = byId.get(o.activityId)!;
        const f = rowToFields(a as unknown as ActivityRow);
        const rec = records.find((r) => r.shiftId === s.shiftId && r.planActivityId === o.activityId && r.dueKey === o.dueKey && r.status !== 'VOID');
        return {
          activityId: o.activityId,
          dueKey: o.dueKey,
          dueAt: o.dueAt.toISOString(),
          category: f.category,
          title: pickText(f.title, locale),
          instructions: pickText(f.instructions, locale),
          timing: f.timing,
          slot: f.slot,
          isCritical: f.isCritical,
          status: rec ? (rec.status as 'DONE' | 'NOT_DONE') : null,
          source: rec ? (rec.source as CareRecordSource) : null,
          reason: rec?.reason ?? null,
          recordedAt: rec ? new Date(rec.recordedAt).toISOString() : null,
          recordedBy: rec?.recordedByUserId ? (names.get(rec.recordedByUserId) ?? null) : null,
        };
      });
      return {
        shiftId: s.shiftId,
        bookingId: s.bookingId,
        bookingReference: s.bookingReference,
        startsAt: s.startsAt.toISOString(),
        endsAt: s.endsAt.toISOString(),
        shiftStatus: s.status,
        cutOffAt: cutOff.toISOString(),
        locked,
        canMark: viewer === 'CLIENT' ? !locked && now >= s.startsAt : viewer === 'STAFF' ? now >= s.startsAt : false,
        isCover: s.caregiverId !== s.bookedCaregiverId,
        caregiverName: viewer === 'STAFF' ? s.caregiverName : null,
        planNotes: s.planNotes,
        items,
      };
    });
  }

  private async userNames(ids: (string | null)[]) {
    const unique = [...new Set(ids.filter((v): v is string => Boolean(v)))];
    if (!unique.length) return new Map<string, string>();
    const rows = await this.db.select({ id: users.id, fullName: users.fullName }).from(users).where(inArray(users.id, unique));
    return new Map(rows.map((r) => [r.id, r.fullName]));
  }

  // --- staff: the care log ---------------------------------------------------------------

  async careLog(bookingId: string, query: { from?: string; to?: string }, locale: Locale): Promise<CareLogResponse> {
    await this.bookingOrThrow(bookingId);
    const today = colomboToday();
    const to = query.to && isValidDate(query.to) ? query.to : addDays(today, 1);
    let from = query.from && isValidDate(query.from) ? query.from : addDays(to, -LOG_DEFAULT_DAYS);
    if (from > to) throw new BadRequestException('The start date must be on or before the end date');
    if (addDays(from, LOG_MAX_DAYS) < to) from = addDays(to, -LOG_MAX_DAYS);
    const shifts = await this.shiftContexts(
      and(eq(bookingShifts.bookingId, bookingId), gte(bookingShifts.startsAt, colomboToUtc(from, '00:00')), lt(bookingShifts.startsAt, colomboToUtc(addDays(to, 1), '00:00'))),
    );
    const lists = (await this.checklists(shifts, 'STAFF', locale)).reverse();
    const items = lists.flatMap((l) => l.items.map((i) => ({ ...i, locked: l.locked })));
    return {
      from,
      to,
      shifts: lists,
      totals: {
        due: items.length,
        done: items.filter((i) => i.status === 'DONE' && i.source !== 'AUTO').length,
        notDone: items.filter((i) => i.status === 'NOT_DONE').length,
        auto: items.filter((i) => i.source === 'AUTO').length,
        open: items.filter((i) => i.status === null).length,
        criticalNotConfirmed: items.filter((i) => i.isCritical && (i.status === 'NOT_DONE' || i.source === 'AUTO')).length,
      },
    };
  }

  // --- recording outcomes ------------------------------------------------------------------

  private async upsertRecord(
    ctx: ShiftContext,
    dto: CareRecordDto,
    source: Exclude<CareRecordSource, 'AUTO'>,
    actor: AuthenticatedUser,
  ) {
    const activities = await this.planActivities([ctx.planId]);
    const occ = careOccurrences(
      activities.map((a) => ({ ...rowToFields(a as unknown as ActivityRow), id: a.id, sortOrder: a.sortOrder, effectiveFrom: a.effectiveFrom, effectiveTo: a.effectiveTo })),
      ctx,
    ).find((o) => o.activityId === dto.activityId && o.dueKey === dto.dueKey);
    if (!occ) throw new BadRequestException('That activity is not due on this shift');
    const activity = activities.find((a) => a.id === dto.activityId)!;
    const reason = dto.status === 'NOT_DONE' ? (dto.reason?.trim() || null) : source === 'STAFF' ? (dto.reason?.trim() || null) : null;
    const values = {
      status: dto.status,
      source,
      reason,
      isCritical: activity.isCritical,
      recordedByUserId: actor.userId,
      recordedAt: new Date(),
    };
    await this.db
      .insert(careActivityRecords)
      .values({ id: uuid(), planActivityId: dto.activityId, shiftId: ctx.shiftId, bookingId: ctx.bookingId, dueKey: dto.dueKey, dueDate: occ.dueDate, ...values })
      .onDuplicateKeyUpdate({ set: values });
  }

  /** Staff correct or fill in a record at any time once the shift has started; a reason is required. */
  async staffRecord(bookingId: string, dto: CareRecordDto, actor: AuthenticatedUser, locale: Locale): Promise<CareChecklistShift> {
    if (!dto.reason?.trim()) throw new BadRequestException('Say why you are changing this record');
    const [ctx] = await this.shiftContexts(and(eq(bookingShifts.id, dto.shiftId), eq(bookingShifts.bookingId, bookingId)), 1);
    if (!ctx) throw new NotFoundException('Shift not found');
    if (Date.now() < ctx.startsAt.getTime()) throw new BadRequestException('This shift has not started yet');
    await this.upsertRecord(ctx, dto, 'STAFF', actor);
    const [list] = await this.checklists([ctx], 'STAFF', locale);
    return list;
  }

  // --- the client --------------------------------------------------------------------------

  private clientOnly(user: AuthenticatedUser) {
    if (user.role !== 'PATIENT_GUARDIAN' || !user.patientId) throw new ForbiddenException('You do not have permission to perform this action');
    return user.patientId;
  }

  /**
   * One day of care for the client: shifts that start that day, and - when the
   * day is today - earlier shifts still open (an overnight shift from last night).
   */
  async clientDay(user: AuthenticatedUser, date: string | undefined, locale: Locale): Promise<ClientCareDay> {
    const patientId = this.clientOnly(user);
    const today = colomboToday();
    const day = date && isValidDate(date) ? date : today;
    if (day < addDays(today, -CLIENT_DAYS_BACK) || day > addDays(today, CLIENT_DAYS_AHEAD)) throw new BadRequestException('Choose a date closer to today');
    const now = new Date();
    const shifts = (
      await this.shiftContexts(
        and(eq(bookings.patientId, patientId), gte(bookingShifts.startsAt, colomboToUtc(addDays(day, -1), '00:00')), lt(bookingShifts.startsAt, colomboToUtc(addDays(day, 1), '00:00'))),
      )
    ).filter((s) => shiftCareDate(s.startsAt) === day || (day === today && careCutOff(s.endsAt) > now));
    const [p] = await this.db.select({ reminders: patients.careRemindersEnabled }).from(patients).where(eq(patients.id, patientId)).limit(1);
    return { date: day, today, reminders: Boolean(p?.reminders), shifts: await this.checklists(shifts, 'CLIENT', locale, now) };
  }

  /** The client marks one item Done or Not done - only on their own booking, once the shift has started, until its cut-off. */
  async clientRecord(user: AuthenticatedUser, dto: CareRecordDto, locale: Locale): Promise<CareChecklistShift> {
    const patientId = this.clientOnly(user);
    const [ctx] = await this.shiftContexts(and(eq(bookingShifts.id, dto.shiftId), eq(bookings.patientId, patientId)), 1);
    if (!ctx) throw new NotFoundException('Shift not found');
    const now = new Date();
    if (now < ctx.startsAt) throw new BadRequestException('This shift has not started yet');
    if (now >= careCutOff(ctx.endsAt)) throw new BadRequestException('This day is closed - report a problem if something is wrong');
    await this.upsertRecord(ctx, dto, 'CLIENT', user);
    const [list] = await this.checklists([ctx], 'CLIENT', locale, now);
    return list;
  }

  async setReminders(user: AuthenticatedUser, enabled: boolean) {
    const patientId = this.clientOnly(user);
    await this.db.update(patients).set({ careRemindersEnabled: enabled }).where(eq(patients.id, patientId));
    return { reminders: enabled };
  }

  // --- the caregiver ------------------------------------------------------------------------

  /** The plan for one of the caregiver's own shifts, from a day before it starts until its cut-off. Read-only. */
  async caregiverShift(user: AuthenticatedUser, shiftId: string, locale: Locale): Promise<CareChecklistShift> {
    if (user.role !== 'CAREGIVER' || !user.caregiverId) throw new ForbiddenException('You do not have permission to perform this action');
    const [ctx] = await this.shiftContexts(and(eq(bookingShifts.id, shiftId), eq(bookingShifts.caregiverId, user.caregiverId)), 1);
    if (!ctx) throw new NotFoundException('No care plan for this shift');
    const now = Date.now();
    if (now < ctx.startsAt.getTime() - CAREGIVER_PLAN_LEAD_HOURS * 3_600_000 || now >= careCutOff(ctx.endsAt).getTime()) {
      throw new ForbiddenException('The care plan is available from a day before the shift until the end of its day');
    }
    const [list] = await this.checklists([ctx], 'CAREGIVER', locale);
    return list;
  }

  /** Which of these shifts the caregiver can open a plan for now (used by the shift list). */
  async caregiverPlanShiftIds(caregiverId: string, shiftIds: string[]): Promise<Set<string>> {
    if (!shiftIds.length) return new Set();
    const rows = await this.shiftContexts(and(eq(bookingShifts.caregiverId, caregiverId), inArray(bookingShifts.id, shiftIds)), shiftIds.length);
    const now = Date.now();
    return new Set(
      rows.filter((s) => now >= s.startsAt.getTime() - CAREGIVER_PLAN_LEAD_HOURS * 3_600_000 && now < careCutOff(s.endsAt).getTime()).map((s) => s.shiftId),
    );
  }

  // --- reminders -------------------------------------------------------------------------------

  /**
   * Clients who asked for reminders and have items still unmarked on shifts
   * that have started and are still open, with how many and the language of
   * their booking. Used by the evening reminder.
   */
  async openItemsForReminders(now = new Date()): Promise<{ patientId: string; language: Locale; count: number }[]> {
    const enabled = (await this.db.select({ id: patients.id }).from(patients).where(eq(patients.careRemindersEnabled, true))).map((p) => p.id);
    if (!enabled.length) return [];
    const today = colomboToday(now);
    const out = new Map<string, { patientId: string; language: Locale; count: number }>();
    for (let i = 0; i < enabled.length; i += 200) {
      const shifts = (
        await this.shiftContexts(
          and(inArray(bookings.patientId, enabled.slice(i, i + 200)), gte(bookingShifts.startsAt, colomboToUtc(addDays(today, -1), '00:00')), lt(bookingShifts.startsAt, now)),
          2000,
        )
      ).filter((s) => careCutOff(s.endsAt) > now);
      const lists = await this.checklists(shifts, 'CLIENT', 'en', now);
      lists.forEach((l, idx) => {
        const open = l.items.filter((it) => it.status === null).length;
        if (!open) return;
        const s = shifts[idx];
        const prev = out.get(s.patientId);
        out.set(s.patientId, { patientId: s.patientId, language: prev?.language ?? s.language, count: (prev?.count ?? 0) + open });
      });
    }
    return [...out.values()];
  }

  // --- attention -------------------------------------------------------------------------------

  /** Critical items marked Not done, and critical items nobody confirmed, over the last 7 days. */
  async attention(today = colomboToday()) {
    const since = addDays(today, -7);
    const rows = await this.db
      .select({
        notDone: sql<string>`SUM(CASE WHEN ${careActivityRecords.status} = 'NOT_DONE' THEN 1 ELSE 0 END)`,
        auto: sql<string>`SUM(CASE WHEN ${careActivityRecords.status} = 'DONE' AND ${careActivityRecords.source} = 'AUTO' THEN 1 ELSE 0 END)`,
      })
      .from(careActivityRecords)
      .where(and(gte(careActivityRecords.dueDate, since), eq(careActivityRecords.isCritical, true)));
    return { criticalNotDone: Number(rows[0]?.notDone ?? 0), criticalUnconfirmed: Number(rows[0]?.auto ?? 0) };
  }
}
