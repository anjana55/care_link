import { mysqlTable, varchar, datetime, mysqlEnum, boolean, decimal, uniqueIndex } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { careTypeEnum } from './care-requests.schema';
import { rateTypeEnum } from './bookings.schema';

/**
 * How each kind of care is priced (Settings > Rates and fees): the unit, the
 * band a caregiver's own rate must stay within, and the platform fee added
 * on top for the client. One row per care type; a care type with no row has
 * caregiver-set rates switched off, so a fresh install prices bookings by
 * hand exactly as before.
 */
export const careTypePricing = mysqlTable('care_type_pricing', {
  careType: mysqlEnum('care_type', careTypeEnum).primaryKey(),
  enabled: boolean('enabled').notNull().default(false),
  rateType: mysqlEnum('rate_type', rateTypeEnum).notNull(),
  minRate: decimal('min_rate', { precision: 10, scale: 2, mode: 'number' }).notNull().default(0),
  maxRate: decimal('max_rate', { precision: 10, scale: 2, mode: 'number' }).notNull().default(0),
  feePercent: decimal('fee_percent', { precision: 5, scale: 2, mode: 'number' }).notNull().default(0),
  updatedBy: varchar('updated_by', { length: 36 }),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * A caregiver's own rate for one kind of care, in the unit that care type is
 * priced in. This is what they are paid; the client's price is worked out
 * from it and the fee, never stored, so a fee change shows at once.
 */
export const caregiverRates = mysqlTable(
  'caregiver_rates',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    caregiverId: varchar('caregiver_id', { length: 36 }).notNull(),
    careType: mysqlEnum('care_type', careTypeEnum).notNull(),
    amount: decimal('amount', { precision: 10, scale: 2, mode: 'number' }).notNull(),
    /** Who last set it: the caregiver themselves, or staff on their behalf. */
    updatedBy: varchar('updated_by', { length: 36 }),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    caregiverCareType: uniqueIndex('caregiver_rates_caregiver_care_type').on(t.caregiverId, t.careType),
  }),
);
