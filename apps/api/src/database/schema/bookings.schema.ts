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

/** How the agreed rate is expressed. Recorded only - CareLink does not invoice yet. */
export const rateTypeEnum = ['HOURLY', 'DAILY', 'MONTHLY'] as const;
export type RateType = (typeof rateTypeEnum)[number];

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

    // --- agreed rate (recorded, not invoiced) --------------------------------
    rateType: mysqlEnum('rate_type', rateTypeEnum),
    rateAmount: decimal('rate_amount', { precision: 10, scale: 2 }),

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

/** Staff-side history of a booking. */
export const bookingEventTypeEnum = [
  'CREATED',
  'REGENERATED',
  'CONFIRMED',
  'EXTENDED',
  'SHIFT_ADDED',
  'SHIFT_CHANGED',
  'SHIFT_REMOVED',
  'NOTE',
  'COMPLETED',
  'CANCELLED',
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
