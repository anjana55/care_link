import {
  mysqlTable,
  varchar,
  int,
  text,
  date,
  datetime,
  mysqlEnum,
  index,
} from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

export const genderEnum = ['MALE', 'FEMALE', 'OTHER'] as const;
export const civilStatusEnum = ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'OTHER'] as const;
export const caregiverStatusEnum = [
  'DRAFT',
  'REGISTERED',
  'DOCUMENTS_PENDING',
  'UNDER_VERIFICATION',
  'VERIFIED',
  'ACTIVE',
  'INACTIVE',
  'SUSPENDED',
  'REJECTED',
] as const;

export type Gender = (typeof genderEnum)[number];
export type CivilStatus = (typeof civilStatusEnum)[number];
export type CaregiverStatus = (typeof caregiverStatusEnum)[number];

// Allowed status transitions - enforced in the service layer, documented here
// so the state machine lives next to the entity it governs.
export const CAREGIVER_STATUS_TRANSITIONS: Record<CaregiverStatus, CaregiverStatus[]> = {
  DRAFT: ['REGISTERED'],
  REGISTERED: ['DOCUMENTS_PENDING', 'REJECTED'],
  DOCUMENTS_PENDING: ['UNDER_VERIFICATION', 'REJECTED'],
  UNDER_VERIFICATION: ['VERIFIED', 'REJECTED', 'DOCUMENTS_PENDING'],
  VERIFIED: ['ACTIVE', 'REJECTED'],
  ACTIVE: ['INACTIVE', 'SUSPENDED'],
  INACTIVE: ['ACTIVE'],
  SUSPENDED: ['ACTIVE', 'REJECTED'],
  REJECTED: [],
};

export const caregivers = mysqlTable(
  'caregivers',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    // Stable identifier shown to anonymous public-search visitors instead of
    // the internal `id`. Generated once at creation, independent of the PK
    // so it can be rotated later without touching any internal FK. Never
    // derived (e.g. HMAC of `id`) on purpose - a stored column can be
    // reissued if it ever leaks in a way that matters; a derived one can't.
    publicId: varchar('public_id', { length: 36 }).notNull().unique(),
    // Null for caregivers a staff member created on someone's behalf who
    // haven't (yet) linked a self-service account. Set at self-registration
    // time and never reassigned - one caregiver record, one owning login.
    userId: varchar('user_id', { length: 36 }).unique(),
    registrationNumber: varchar('registration_number', { length: 32 }).notNull().unique(),
    fullName: varchar('full_name', { length: 255 }).notNull(),
    permanentAddress: text('permanent_address').notNull(),
    nic: varchar('nic', { length: 20 }).unique(),
    passportNumber: varchar('passport_number', { length: 20 }).unique(),
    dateOfBirth: date('date_of_birth').notNull(),
    gender: mysqlEnum('gender', genderEnum).notNull(),
    civilStatus: mysqlEnum('civil_status', civilStatusEnum).notNull(),
    heightCm: int('height_cm'),
    weightKg: int('weight_kg'),
    primaryPhone: varchar('primary_phone', { length: 20 }).notNull().unique(),
    secondaryPhone: varchar('secondary_phone', { length: 20 }),
    emergencyContactName: varchar('emergency_contact_name', { length: 255 }).notNull(),
    emergencyContactNumber: varchar('emergency_contact_number', { length: 20 }).notNull(),
    emergencyContactRelationship: varchar('emergency_contact_relationship', { length: 100 }).notNull(),
    policeDivision: varchar('police_division', { length: 100 }),
    policeStation: varchar('police_station', { length: 100 }),
    district: varchar('district', { length: 100 }),
    city: varchar('city', { length: 100 }),
    postalCode: varchar('postal_code', { length: 20 }),
    status: mysqlEnum('status', caregiverStatusEnum).notNull().default('DRAFT'),
    // Set at self-registration time when the caregiver accepts data-processing
    // consent. Null for staff-entered records (consent isn't meaningful when
    // staff, not the caregiver, filled the form in).
    consentAcceptedAt: datetime('consent_accepted_at'),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    deletedAt: datetime('deleted_at'),
  },
  (table) => ({
    statusIdx: index('caregivers_status_idx').on(table.status),
    nameIdx: index('caregivers_name_idx').on(table.fullName),
    publicIdIdx: index('caregivers_public_id_idx').on(table.publicId),
    // Public search's most common shape: ACTIVE caregivers filtered by location.
    publicSearchIdx: index('caregivers_public_search_idx').on(table.status, table.district, table.city),
  }),
);
