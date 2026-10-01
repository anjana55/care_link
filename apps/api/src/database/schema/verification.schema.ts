import { mysqlTable, varchar, text, datetime, mysqlEnum, index } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { verificationStatusEnum } from './qualifications.schema';

export const references = mysqlTable(
  'references',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    caregiverId: varchar('caregiver_id', { length: 36 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    relationship: varchar('relationship', { length: 100 }).notNull(),
    phone: varchar('phone', { length: 20 }).notNull(),
    email: varchar('email', { length: 255 }),
    verificationStatus: mysqlEnum('verification_status', verificationStatusEnum).notNull().default('PENDING'),
    notes: text('notes'),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    caregiverIdx: index('references_caregiver_idx').on(table.caregiverId),
  }),
);

export const verificationTypeEnum = [
  'IDENTITY',
  'POLICE_CLEARANCE',
  'QUALIFICATION',
  'EXPERIENCE',
  'REFERENCE',
  'OVERALL',
] as const;
export type VerificationType = (typeof verificationTypeEnum)[number];

export const verifications = mysqlTable(
  'verifications',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    caregiverId: varchar('caregiver_id', { length: 36 }).notNull(),
    verificationType: mysqlEnum('verification_type', verificationTypeEnum).notNull(),
    status: mysqlEnum('status', verificationStatusEnum).notNull().default('PENDING'),
    verifiedByUserId: varchar('verified_by_user_id', { length: 36 }),
    verifiedAt: datetime('verified_at'),
    notes: text('notes'),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    caregiverIdx: index('verifications_caregiver_idx').on(table.caregiverId),
  }),
);
