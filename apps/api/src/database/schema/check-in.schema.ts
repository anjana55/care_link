import { boolean, datetime, decimal, index, int, mysqlEnum, mysqlTable, varchar } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

/**
 * Settings > Check-in: a single row, id 'default', like the other settings.
 * Off by default, so nobody sees an arrival code or a check-in button until
 * an admin switches it on.
 */
export const checkInSettings = mysqlTable('check_in_settings', {
  id: varchar('id', { length: 36 }).primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  /** How long before a shift starts a caregiver may check in. */
  earlyMinutes: int('early_minutes').notNull().default(60),
  /** Minutes after the start with no check-in before staff are told. */
  lateAfterMinutes: int('late_after_minutes').notNull().default(15),
  updatedBy: varchar('updated_by', { length: 36 }),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

export const checkInByEnum = ['CAREGIVER', 'STAFF'] as const;

/**
 * One row per shift that anyone has tried to check in to: when the caregiver
 * arrived and left, who recorded it (the caregiver with the client's code, or
 * staff on their behalf), and where the phone was when it could say.
 *
 * It sits beside the shift rather than on it: a check-in never changes a
 * shift's status, times or what is billed. The arrival code is not stored -
 * it is worked out from the shift's id and a server key - only how many
 * wrong ones were tried.
 */
export const shiftCheckins = mysqlTable(
  'shift_checkins',
  {
    shiftId: varchar('shift_id', { length: 36 }).primaryKey(),
    bookingId: varchar('booking_id', { length: 36 }).notNull(),
    wrongCodes: int('wrong_codes').notNull().default(0),

    checkedInAt: datetime('checked_in_at', { fsp: 3 }),
    inBy: mysqlEnum('in_by', checkInByEnum),
    inByUserId: varchar('in_by_user_id', { length: 36 }),
    inNote: varchar('in_note', { length: 300 }),
    inLatitude: decimal('in_latitude', { precision: 9, scale: 6, mode: 'number' }),
    inLongitude: decimal('in_longitude', { precision: 9, scale: 6, mode: 'number' }),
    inAccuracyM: int('in_accuracy_m'),
    /** Metres from the booking's first located check-in, worked out when this one was made. */
    inDistanceM: int('in_distance_m'),

    checkedOutAt: datetime('checked_out_at', { fsp: 3 }),
    outBy: mysqlEnum('out_by', checkInByEnum),
    outByUserId: varchar('out_by_user_id', { length: 36 }),
    outNote: varchar('out_note', { length: 300 }),
    outLatitude: decimal('out_latitude', { precision: 9, scale: 6, mode: 'number' }),
    outLongitude: decimal('out_longitude', { precision: 9, scale: 6, mode: 'number' }),
    outAccuracyM: int('out_accuracy_m'),

    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    // "Where did earlier visits on this booking check in?"
    bookingIdx: index('shift_checkins_booking_idx').on(table.bookingId, table.checkedInAt),
  }),
);
