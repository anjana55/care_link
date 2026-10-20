import { mysqlTable, varchar, datetime, date, mysqlEnum, text, index, decimal, char } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { careRequestLanguageEnum } from './care-requests.schema';

/**
 * A booking: one caregiver placed with one client over a date range, on a
 * repeating pattern (which weekdays, from what time to what time). Staff make
 * it - usually from an INTRODUCED care request - and the pattern is turned into
 * individual dated shifts (booking_shifts) that staff can then adjust one by
 * one, down to the minute.
 *
 * Lifecycle:
 * - DRAFT      shifts exist as drafts; staff are still shaping the roster.
 *              Nobody outside the staff app sees a draft.
 * - CONFIRMED  staff agreed it with both sides; drafts became SCHEDULED, the
 *              client and caregiver are told and can see their shifts.
 * - COMPLETED  the engagement is over.
 * - CANCELLED  called off; remaining scheduled shifts are cancelled with it.
 */
export const bookingStatusEnum = ['DRAFT', 'CONFIRMED', 'COMPLETED', 'CANCELLED'] as const;
export type BookingStatus = (typeof bookingStatusEnum)[number];

/** Day/night/live-in mirror the caregiver availability flags; CUSTOM is any other pattern. */
export const scheduleTypeEnum = ['DAY', 'NIGHT', 'LIVE_IN', 'CUSTOM'] as const;
export type ScheduleType = (typeof scheduleTypeEnum)[number];

/** How a rate is expressed - the client's agreed rate and the caregiver's pay rate alike. */
export const rateTypeEnum = ['HOURLY', 'DAILY', 'MONTHLY'] as const;
export type RateType = (typeof rateTypeEnum)[number];

/**
 * How a single shift's own rate is expressed. A shift is one piece of work, so
 * it is priced by its hours or as a whole shift (DAILY: one unit per shift) -
 * never by the month.
 */
export const shiftRateTypeEnum = ['HOURLY', 'DAILY'] as const;
export type ShiftRateType = (typeof shiftRateTypeEnum)[number];

export const bookings = mysqlTable(
  'bookings',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    reference: varchar('reference', { length: 16 }).notNull().unique(),
    // The request this booking came from, when it came from one. Confirming
    // the booking closes that request as PLACED.
    careRequestId: varchar('care_request_id', { length: 36 }),
    patientId: varchar('patient_id', { length: 36 }).notNull(),
    // The booked caregiver. Individual shifts may be covered by someone else
    // (booking_shifts.caregiver_id) without changing this.
    caregiverId: varchar('caregiver_id', { length: 36 }).notNull(),
    status: mysqlEnum('status', bookingStatusEnum).notNull().default('DRAFT'),

    // --- the pattern the shifts were generated from --------------------------
    scheduleType: mysqlEnum('schedule_type', scheduleTypeEnum).notNull(),
    // ISO weekdays, comma-separated: "1,2,3,4,5" = Monday to Friday.
    daysOfWeek: varchar('days_of_week', { length: 13 }).notNull(),
    // Colombo wall-clock 'HH:MM'. An end at or before the start runs into the next day.
    shiftStartTime: char('shift_start_time', { length: 5 }).notNull(),
    shiftEndTime: char('shift_end_time', { length: 5 }).notNull(),
    // 'YYYY-MM-DD', kept as strings end to end so no time zone ever shifts the day.
    startDate: date('start_date', { mode: 'string' }).notNull(),
    endDate: date('end_date', { mode: 'string' }).notNull(),

    // --- money ----------------------------------------------------------------
    // What the client is charged; invoices price their shift lines from it.
    rateType: mysqlEnum('rate_type', rateTypeEnum),
    rateAmount: decimal('rate_amount', { precision: 10, scale: 2 }),
    // What the caregiver is paid - for the booked caregiver and any cover
    // alike; payout statements price shift lines from it. Staff only: never
    // shown to the client, and the caregiver sees it only on their statement.
    payRateType: mysqlEnum('pay_rate_type', rateTypeEnum),
    payRateAmount: decimal('pay_rate_amount', { precision: 10, scale: 2 }),

    // The language the client's notices go out in (from the request, or chosen by staff).
    language: mysqlEnum('language', careRequestLanguageEnum).notNull().default('en'),
    notes: text('notes'),

    createdByUserId: varchar('created_by_user_id', { length: 36 }),
    confirmedAt: datetime('confirmed_at'),
    confirmedByUserId: varchar('confirmed_by_user_id', { length: 36 }),
    cancelledAt: datetime('cancelled_at'),
    cancelReason: varchar('cancel_reason', { length: 500 }),
    completedAt: datetime('completed_at'),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    patientIdx: index('bookings_patient_idx').on(table.patientId),
    caregiverIdx: index('bookings_caregiver_idx').on(table.caregiverId),
    requestIdx: index('bookings_request_idx').on(table.careRequestId),
    statusIdx: index('bookings_status_idx').on(table.status, table.startDate),
  }),
);

/**
 * One dated piece of work. Generated from the booking's pattern, then edited
 * freely: times to the minute, a cover caregiver, an extra one-off shift.
 *
 * - DRAFT      belongs to a DRAFT booking; invisible outside the staff app.
 * - SCHEDULED  confirmed; counts against the caregiver's time (no overlaps).
 * - COMPLETED / MISSED  what actually happened.
 * - CANCELLED  will not happen; frees the caregiver's time.
 */
export const shiftStatusEnum = ['DRAFT', 'SCHEDULED', 'COMPLETED', 'MISSED', 'CANCELLED'] as const;
export type ShiftStatus = (typeof shiftStatusEnum)[number];

/** Shift statuses that hold a caregiver's time - a new shift may not overlap these. */
export const BLOCKING_SHIFT_STATUSES: readonly ShiftStatus[] = ['SCHEDULED', 'COMPLETED'];

export const bookingShifts = mysqlTable(
  'booking_shifts',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    bookingId: varchar('booking_id', { length: 36 }).notNull(),
    // Who works this shift: the booked caregiver, or a cover.
    caregiverId: varchar('caregiver_id', { length: 36 }).notNull(),
    // UTC instants (see packages/shared bookings.ts for the Colombo conversion).
    startsAt: datetime('starts_at').notNull(),
    endsAt: datetime('ends_at').notNull(),
    status: mysqlEnum('status', shiftStatusEnum).notNull().default('DRAFT'),
    note: varchar('note', { length: 500 }),
    // This shift's own rates, when it is priced differently from the booking -
    // a holiday, a longer day, a cover paid more. Null = the booking's rate.
    // Each side is set or cleared on its own. Shifts folded into a monthly
    // line (the client side of a MONTHLY booking, or the booked caregiver's
    // pay on one) are priced by the month and cannot carry their own rate.
    rateType: mysqlEnum('rate_type', shiftRateTypeEnum),
    rateAmount: decimal('rate_amount', { precision: 10, scale: 2 }),
    payRateType: mysqlEnum('pay_rate_type', shiftRateTypeEnum),
    payRateAmount: decimal('pay_rate_amount', { precision: 10, scale: 2 }),
    updatedByUserId: varchar('updated_by_user_id', { length: 36 }),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    bookingIdx: index('booking_shifts_booking_idx').on(table.bookingId, table.startsAt),
    // Overlap checks and a caregiver's own roster both read by caregiver + time.
    caregiverIdx: index('booking_shifts_caregiver_idx').on(table.caregiverId, table.startsAt),
  }),
);

/**
 * Staff-side history of a booking. UPDATED: rates, notes, language or the
 * booked caregiver on a draft; RESCHEDULED: a confirmed booking's pattern or
 * caregiver changed from a given day on; AMENDED: a correction to work that
 * already happened (see booking_amendments).
 */
export const bookingEventTypeEnum = [
  'CREATED',
  'UPDATED',
  'REGENERATED',
  'RESCHEDULED',
  'CONFIRMED',
  'EXTENDED',
  'SHIFT_ADDED',
  'SHIFT_CHANGED',
  'SHIFT_REMOVED',
  'NOTE',
  'COMPLETED',
  'CANCELLED',
  'AMENDED',
] as const;
export type BookingEventType = (typeof bookingEventTypeEnum)[number];

export const bookingEvents = mysqlTable(
  'booking_events',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    bookingId: varchar('booking_id', { length: 36 }).notNull(),
    type: mysqlEnum('type', bookingEventTypeEnum).notNull(),
    note: text('note'),
    actorUserId: varchar('actor_user_id', { length: 36 }),
    createdAt: datetime('created_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => ({
    bookingIdx: index('booking_events_booking_idx').on(table.bookingId, table.createdAt),
  }),
);

/**
 * A correction to work that already happened - a shift that ran longer, was
 * missed, was covered by someone else, or was priced wrong - made after the
 * fact, usually once it is on an invoice or a pay statement.
 *
 * Issued documents are never rewritten by it. What the correction did to them
 * is recorded in `summary` (JSON, see BookingAmendmentSummary in
 * packages/shared): draft documents refreshed, an unpaid invoice replaced by a
 * corrected copy, or the difference carried forward as a billing adjustment.
 */
export const bookingAmendments = mysqlTable(
  'booking_amendments',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    bookingId: varchar('booking_id', { length: 36 }).notNull(),
    reason: varchar('reason', { length: 500 }).notNull(),
    summary: text('summary').notNull(),
    actorUserId: varchar('actor_user_id', { length: 36 }),
    createdAt: datetime('created_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => ({
    bookingIdx: index('booking_amendments_booking_idx').on(table.bookingId, table.createdAt),
  }),
);
