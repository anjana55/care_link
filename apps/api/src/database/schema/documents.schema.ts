import { mysqlTable, varchar, int, datetime, mysqlEnum, index } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { verificationStatusEnum } from './qualifications.schema';

export const documentTypeEnum = [
  'NIC',
  'PASSPORT',
  'GRAMA_NILADHARI_CERTIFICATE',
  'POLICE_CLEARANCE',
  'CAREGIVER_CERTIFICATE',
  'NVQ_CERTIFICATE',
  'NURSING_CERTIFICATE',
  'CV',
  'OTHER',
] as const;
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
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    caregiverIdx: index('caregiver_documents_caregiver_idx').on(table.caregiverId),
  }),
);
