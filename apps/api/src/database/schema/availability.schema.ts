import { mysqlTable, varchar, boolean, int, date, datetime, decimal, mysqlEnum } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

export const shiftPreferenceEnum = ['DAY', 'NIGHT', 'TWENTY_FOUR_HOUR_LIVE_IN', 'FLEXIBLE'] as const;
export type ShiftPreference = (typeof shiftPreferenceEnum)[number];

export const availability = mysqlTable('availability', {
  id: varchar('id', { length: 36 }).primaryKey(),
  caregiverId: varchar('caregiver_id', { length: 36 }).notNull().unique(),
  dayDuty: boolean('day_duty').notNull().default(false),
  nightDuty: boolean('night_duty').notNull().default(false),
  liveIn24h: boolean('live_in_24h').notNull().default(false),
  availableFrom: date('available_from'),
  preferredShift: mysqlEnum('preferred_shift', shiftPreferenceEnum).notNull().default('FLEXIBLE'),
  expectedDailyRate: decimal('expected_daily_rate', { precision: 10, scale: 2 }),
  expectedMonthlyRate: decimal('expected_monthly_rate', { precision: 10, scale: 2 }),
  expectedLeaveDays: int('expected_leave_days'),
  preferredLeavePattern: varchar('preferred_leave_pattern', { length: 255 }),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
