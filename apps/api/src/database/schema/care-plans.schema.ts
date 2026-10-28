import { mysqlTable, varchar, datetime, date, mysqlEnum, text, index, json, boolean, int, uniqueIndex } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import {
  careActivityCategoryValues,
  careActivityTimingValues,
  carePlanTemplateStatusValues,
  careRecordSourceValues,
  careRecordStatusValues,
  careSlotValues,
  type LocalizedText,
} from '@care-platform/shared';

/**
 * Care plans - see packages/shared/src/types/care-plans.ts for the rules.
 *
 * Templates are a staff library; applying one COPIES its activities into the
 * booking's plan, so editing a template never changes a plan already made.
 * A plan activity is in force from effective_from to effective_to (inclusive);
 * an edit closes the old row the day before it takes effect and opens a new
 * one, so the record of what was due on a past day never changes.
 *
 * What is due on a shift is worked out from the plan and the shift; only
 * outcomes are stored (care_activity_records) - the client's ticks, staff
 * corrections, and the Done items the midnight sweep fills in.
 */

// Activity columns shared by templates and plans. Text is per language (JSON {en, si, ta}).
const activityColumns = () => ({
  sortOrder: int('sort_order').notNull().default(0),
  category: mysqlEnum('category', careActivityCategoryValues).notNull(),
  title: json('title').$type<LocalizedText>().notNull(),
  instructions: json('instructions').$type<LocalizedText>(),
  timing: mysqlEnum('timing', careActivityTimingValues).notNull().default('ANY'),
  slot: mysqlEnum('slot', careSlotValues),
  // 'HH:MM' Colombo times, comma-separated, for AT_TIMES.
  times: varchar('times', { length: 100 }),
  // ISO weekdays of the shift's start, comma-separated; null = every shift.
  daysOfWeek: varchar('days_of_week', { length: 13 }),
  isCritical: boolean('is_critical').notNull().default(false),
});

export const carePlanTemplates = mysqlTable(
  'care_plan_templates',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    name: varchar('name', { length: 150 }).notNull(),
    description: text('description'),
    // Care types (HOME_SHIFT, LIVE_IN, ...) it suits, comma-separated; empty = any.
    careTypes: varchar('care_types', { length: 100 }).notNull().default(''),
    status: mysqlEnum('status', carePlanTemplateStatusValues).notNull().default('ACTIVE'),
    createdByUserId: varchar('created_by_user_id', { length: 36 }),
    updatedByUserId: varchar('updated_by_user_id', { length: 36 }),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    statusIdx: index('care_plan_templates_status_idx').on(table.status, table.name),
  }),
);

export const carePlanTemplateActivities = mysqlTable(
  'care_plan_template_activities',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    templateId: varchar('template_id', { length: 36 }).notNull(),
    ...activityColumns(),
  },
  (table) => ({
    templateIdx: index('care_plan_template_activities_template_idx').on(table.templateId, table.sortOrder),
  }),
);

/** One per booking. */
export const carePlans = mysqlTable(
  'care_plans',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    bookingId: varchar('booking_id', { length: 36 }).notNull(),
    // Where it started from; the name is kept in case the template is renamed or archived.
    sourceTemplateId: varchar('source_template_id', { length: 36 }),
    sourceTemplateName: varchar('source_template_name', { length: 150 }),
    // Things every caregiver on the booking must know (allergies, how to reach the family...).
    notes: text('notes'),
    createdByUserId: varchar('created_by_user_id', { length: 36 }),
    updatedByUserId: varchar('updated_by_user_id', { length: 36 }),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    bookingUnique: uniqueIndex('care_plans_booking_unique').on(table.bookingId),
  }),
);

export const carePlanActivities = mysqlTable(
  'care_plan_activities',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    planId: varchar('plan_id', { length: 36 }).notNull(),
    ...activityColumns(),
    // 'YYYY-MM-DD' Colombo dates, inclusive; effective_to null = open-ended.
    effectiveFrom: date('effective_from', { mode: 'string' }).notNull(),
    effectiveTo: date('effective_to', { mode: 'string' }),
    // The earlier version this one replaced, when it came from an edit.
    replacesActivityId: varchar('replaces_activity_id', { length: 36 }),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    planIdx: index('care_plan_activities_plan_idx').on(table.planId, table.effectiveFrom),
  }),
);

/**
 * The outcome of one occurrence: one activity, on one shift, at one due key
 * ('ANY', a slot, or 'HH:MM'). VOID: the shift turned out missed or cancelled
 * after the sweep had filled it in.
 */
export const careActivityRecords = mysqlTable(
  'care_activity_records',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    planActivityId: varchar('plan_activity_id', { length: 36 }).notNull(),
    shiftId: varchar('shift_id', { length: 36 }).notNull(),
    bookingId: varchar('booking_id', { length: 36 }).notNull(),
    dueKey: varchar('due_key', { length: 10 }).notNull(),
    // Colombo date it was due on.
    dueDate: date('due_date', { mode: 'string' }).notNull(),
    status: mysqlEnum('status', careRecordStatusValues).notNull(),
    source: mysqlEnum('source', careRecordSourceValues).notNull(),
    reason: varchar('reason', { length: 300 }),
    // Copied so the record still reads right if the activity's wording changes.
    isCritical: boolean('is_critical').notNull().default(false),
    recordedByUserId: varchar('recorded_by_user_id', { length: 36 }),
    recordedAt: datetime('recorded_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => ({
    occurrenceUnique: uniqueIndex('care_activity_records_occurrence_unique').on(table.planActivityId, table.shiftId, table.dueKey),
    shiftIdx: index('care_activity_records_shift_idx').on(table.shiftId),
    bookingIdx: index('care_activity_records_booking_idx').on(table.bookingId, table.dueDate),
    attentionIdx: index('care_activity_records_attention_idx').on(table.dueDate, table.isCritical, table.status),
  }),
);

/**
 * A shift the midnight sweep has finalised. Its presence is what makes the
 * sweep run once per shift (the insert is the lock); removed again if the
 * shift is later marked missed or cancelled.
 */
export const careShiftReviews = mysqlTable('care_shift_reviews', {
  shiftId: varchar('shift_id', { length: 36 }).primaryKey(),
  bookingId: varchar('booking_id', { length: 36 }).notNull(),
  cutOffAt: datetime('cut_off_at').notNull(),
  finalizedAt: datetime('finalized_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
});
