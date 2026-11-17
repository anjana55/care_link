import { mysqlTable, varchar, text, datetime, mysqlEnum, index, json, uniqueIndex } from 'drizzle-orm/mysql-core';
import { DOCUMENT_READING_OUTCOMES, ONBOARDING_RECOMMENDATIONS, type OnboardingCheck, type ReadingCheck, type ReferenceAnswer } from '@care-platform/shared';
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
    // The onboarding agent's confirmation request: a one-time link to three questions.
    // Only the SHA-256 of the token is kept; the link itself goes to the referee.
    confirmTokenHash: varchar('confirm_token_hash', { length: 64 }),
    confirmSentAt: datetime('confirm_sent_at'),
    confirmChannel: varchar('confirm_channel', { length: 20 }),
    confirmAnswer: json('confirm_answer').$type<ReferenceAnswer>(),
    confirmAnsweredAt: datetime('confirm_answered_at'),
    confirmEscalatedAt: datetime('confirm_escalated_at'),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    caregiverIdx: index('references_caregiver_idx').on(table.caregiverId),
    confirmTokenIdx: uniqueIndex('references_confirm_token_idx').on(table.confirmTokenHash),
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

/**
 * The onboarding agent's verification file for an applicant caregiver: what
 * it checked and what it recommends, plus what it asked the caregiver for.
 * A recommendation only - staff set the verification.
 */
export const onboardingFiles = mysqlTable('onboarding_files', {
  caregiverId: varchar('caregiver_id', { length: 36 }).primaryKey(),
  recommendation: mysqlEnum('recommendation', ONBOARDING_RECOMMENDATIONS).notNull(),
  checks: json('checks').$type<OnboardingCheck[]>().notNull(),
  assembledAt: datetime('assembled_at').notNull(),
  // When the file last turned READY and staff were told (so they are told once per turn).
  readyNotifiedAt: datetime('ready_notified_at'),
  documentsRequested: varchar('documents_requested', { length: 60 }),
  documentsRequestedAt: datetime('documents_requested_at'),
  documentsEscalatedAt: datetime('documents_escalated_at'),
  /** The one reminder to the caregiver, before staff are told. */
  documentsRemindedAt: datetime('documents_reminded_at'),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});

/**
 * The onboarding agent's reading of one uploaded document: how what the
 * model saw compares with the caregiver's profile. Only the comparison is
 * kept - never the name, number or dates the model read off the document.
 */
export const documentReadings = mysqlTable(
  'document_readings',
  {
    documentId: varchar('document_id', { length: 36 }).primaryKey(),
    caregiverId: varchar('caregiver_id', { length: 36 }).notNull(),
    outcome: mysqlEnum('outcome', DOCUMENT_READING_OUTCOMES).notNull(),
    checks: json('checks').$type<ReadingCheck[]>().notNull(),
    // The expiry shown on the document, so staff can fill it in; not personal.
    expiresOn: varchar('expires_on', { length: 10 }),
    endpointName: varchar('endpoint_name', { length: 100 }).notNull(),
    model: varchar('model', { length: 150 }).notNull(),
    readAt: datetime('read_at').notNull(),
  },
  (table) => ({
    caregiverIdx: index('document_readings_caregiver_idx').on(table.caregiverId),
  }),
);
