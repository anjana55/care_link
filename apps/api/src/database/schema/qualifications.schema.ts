import { mysqlTable, varchar, text, date, datetime, mysqlEnum, index } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

export const qualificationTypeEnum = [
  'NVQ',
  'NURSING_DIPLOMA',
  'NURSING_DEGREE',
  'CAREGIVER_CERTIFICATE',
  'FIRST_AID',
  'OTHER',
] as const;
export const verificationStatusEnum = ['PENDING', 'IN_PROGRESS', 'VERIFIED', 'REJECTED'] as const;

export type QualificationType = (typeof qualificationTypeEnum)[number];
export type VerificationStatus = (typeof verificationStatusEnum)[number];

export const qualifications = mysqlTable(
  'qualifications',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    caregiverId: varchar('caregiver_id', { length: 36 }).notNull(),
    name: varchar('name', { length: 255 }).notNull(),
    type: mysqlEnum('type', qualificationTypeEnum).notNull(),
    institution: varchar('institution', { length: 255 }).notNull(),
    certificateNumber: varchar('certificate_number', { length: 100 }),
    issueDate: date('issue_date'),
    expiryDate: date('expiry_date'),
    verificationStatus: mysqlEnum('verification_status', verificationStatusEnum).notNull().default('PENDING'),
    documentId: varchar('document_id', { length: 36 }),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    caregiverIdx: index('qualifications_caregiver_idx').on(table.caregiverId),
  }),
);

export const experiences = mysqlTable(
  'experiences',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    caregiverId: varchar('caregiver_id', { length: 36 }).notNull(),
    employerOrClient: varchar('employer_or_client', { length: 255 }).notNull(),
    role: varchar('role', { length: 255 }).notNull(),
    location: varchar('location', { length: 255 }),
    country: varchar('country', { length: 100 }).notNull(),
    startDate: date('start_date').notNull(),
    endDate: date('end_date'),
    description: text('description'),
    careType: varchar('care_type', { length: 100 }),
    patientCategory: varchar('patient_category', { length: 100 }),
    referenceContact: varchar('reference_contact', { length: 255 }),
    verificationStatus: mysqlEnum('verification_status', verificationStatusEnum).notNull().default('PENDING'),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    caregiverIdx: index('experiences_caregiver_idx').on(table.caregiverId),
  }),
);
