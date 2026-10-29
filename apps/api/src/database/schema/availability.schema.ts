import { mysqlTable, varchar, boolean, int, date, datetime, decimal, mysqlEnum } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { shiftPreferenceValues } from '@care-platform/shared';

// The list lives in packages/shared/src/types/caregivers.ts, so every client knows these values.
export const shiftPreferenceEnum = shiftPreferenceValues;
export type ShiftPreference = (typeof shiftPreferenceEnum)[number];

export const availability = mysqlTable('availability', {
  id: varchar('id', { length: 36 }).primaryKey(),
  caregiverId: varchar('caregiver_id', { length: 36 }).notNull().unique(),
  dayDuty: boolean('day_duty').notNull().default(false),
  nightDuty: boolean('night_duty').notNull().default(false),
  liveIn24h: boolean('live_in_24h').notNull().default(false),
  // The kinds of care this caregiver takes on (see careTypeValues in
  // @care-platform/shared). A search for a care type leaves out caregivers
  // who have it switched off. All on by default so nobody drops out of
  // search until they (or staff) narrow it down.
  careHomeShift: boolean('care_home_shift').notNull().default(true),
  careLiveIn: boolean('care_live_in').notNull().default(true),
  careHospital: boolean('care_hospital').notNull().default(true),
  careNursingHome: boolean('care_nursing_home').notNull().default(true),
  careRetirementHome: boolean('care_retirement_home').notNull().default(true),
  availableFrom: date('available_from'),
  preferredShift: mysqlEnum('preferred_shift', shiftPreferenceEnum).notNull().default('FLEXIBLE'),
  expectedDailyRate: decimal('expected_daily_rate', { precision: 10, scale: 2 }),
  expectedMonthlyRate: decimal('expected_monthly_rate', { precision: 10, scale: 2 }),
  expectedLeaveDays: int('expected_leave_days'),
  preferredLeavePattern: varchar('preferred_leave_pattern', { length: 255 }),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

/** Which availability column records each care type. */
export const CARE_TYPE_COLUMNS = {
  HOME_SHIFT: 'careHomeShift',
  LIVE_IN: 'careLiveIn',
  HOSPITAL: 'careHospital',
  NURSING_HOME: 'careNursingHome',
  RETIREMENT_HOME: 'careRetirementHome',
} as const satisfies Record<string, keyof typeof availability.$inferSelect>;
