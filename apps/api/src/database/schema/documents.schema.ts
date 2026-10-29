import { mysqlTable, varchar, int, date, datetime, mysqlEnum, index } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { documentTypeValues } from '@care-platform/shared';
import { verificationStatusEnum } from './qualifications.schema';

// The list lives in packages/shared/src/types/caregivers.ts, so every client knows these values.
export const documentTypeEnum = documentTypeValues;
export type DocumentType = (typeof documentTypeEnum)[number];

export const caregiverDocuments = mysqlTable(
  'caregiver_documents',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    caregiverId: varchar('caregiver_id', { length: 36 }).notNull(),
    documentType: mysqlEnum('document_type', documentTypeEnum).notNull(),
    // Opaque storage key (never the original filename) - see StorageService.
    storageKey: varchar('storage_key', { length: 255 }).notNull().unique(),
    originalFilename: varchar('original_filename', { length: 255 }).notNull(),
    mimeType: varchar('mime_type', { length: 100 }).notNull(),
    sizeBytes: int('size_bytes').notNull(),
    checksum: varchar('checksum', { length: 64 }).notNull(),
    uploadedByUserId: varchar('uploaded_by_user_id', { length: 36 }),
    verificationStatus: mysqlEnum('verification_status', verificationStatusEnum).notNull().default('PENDING'),
    verifiedByUserId: varchar('verified_by_user_id', { length: 36 }),
    verifiedAt: datetime('verified_at'),
    // When the document stops being valid (a passport, a police clearance).
    // Null = it does not expire, or nobody has said. Reminders go out before it.
    expiresOn: date('expires_on', { mode: 'string' }),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    caregiverIdx: index('caregiver_documents_caregiver_idx').on(table.caregiverId),
  }),
);
