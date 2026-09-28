import { mysqlTable, varchar, boolean, text, datetime } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

// Deliberately kept in its own table, separate from the core caregiver
// profile, so normal caregiver list/search endpoints never join against it.
export const caregiverHealthInformation = mysqlTable('caregiver_health_information', {
  id: varchar('id', { length: 36 }).primaryKey(),
  caregiverId: varchar('caregiver_id', { length: 36 }).notNull().unique(),
  hasDiabetes: boolean('has_diabetes').notNull().default(false),
  hasHighBloodPressure: boolean('has_high_blood_pressure').notNull().default(false),
  surgicalHistory: text('surgical_history'),
  mentalHealthInformation: text('mental_health_information'),
  physicalAbilityToLiftPatients: boolean('physical_ability_to_lift_patients').notNull().default(true),
  otherNotes: text('other_notes'),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
