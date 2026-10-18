import { mysqlTable, varchar, datetime, mysqlEnum, text, index, uniqueIndex, primaryKey } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

/**
 * A client asking to be put in touch with one caregiver they found on the
 * public site ("Contact this caregiver").
 *
 * Contact is staff-mediated: the request lands in the staff Requests queue,
 * staff call both sides, and neither party ever sees the other's phone number
 * or email through the app. The client only ever refers to the caregiver by
 * their public id; the internal caregiver id and every personal detail stay on
 * the staff side.
 *
 * Lifecycle:
 * - NEW          the client sent it; nobody has picked it up yet.
 * - IN_PROGRESS  a staff member is contacting the client and the caregiver.
 * - INTRODUCED   staff have put the two in touch. Hiring and bookings build
 *                from here in a later phase.
 * - CLOSED       staff closed it (not proceeding, caregiver unavailable...).
 *                Staff can reopen it.
 * - CANCELLED    the client withdrew it. Terminal.
 */
export const careRequestStatusEnum = ['NEW', 'IN_PROGRESS', 'INTRODUCED', 'CLOSED', 'CANCELLED'] as const;
export type CareRequestStatus = (typeof careRequestStatusEnum)[number];

/** Statuses in which a request still counts as open for the one-open-request-per-pair rule. */
export const OPEN_CARE_REQUEST_STATUSES: readonly CareRequestStatus[] = ['NEW', 'IN_PROGRESS'];

/**
 * Moves staff may make, enforced in CareRequestsService.updateStatus. CANCELLED
 * is never a staff move (only the client cancels, from NEW or IN_PROGRESS) and
 * nothing leaves it. A CLOSED request can be reopened into IN_PROGRESS rather
 * than NEW, because reopening is itself staff picking it up.
 */
export const CARE_REQUEST_STATUS_TRANSITIONS: Record<CareRequestStatus, CareRequestStatus[]> = {
  NEW: ['IN_PROGRESS', 'CLOSED'],
  IN_PROGRESS: ['INTRODUCED', 'CLOSED'],
  INTRODUCED: ['IN_PROGRESS', 'CLOSED'],
  CLOSED: ['IN_PROGRESS'],
  CANCELLED: [],
};

/** Why staff closed a request. Required when moving to CLOSED. */
export const careRequestCloseReasonEnum = [
  'CLIENT_NOT_PROCEEDING',
  'CLIENT_UNREACHABLE',
  'CAREGIVER_UNAVAILABLE',
  'CAREGIVER_DECLINED',
  'NOT_A_MATCH',
  'PLACED',
  'OTHER',
] as const;
export type CareRequestCloseReason = (typeof careRequestCloseReasonEnum)[number];

/** The languages a client can receive updates in - the public site's three. */
export const careRequestLanguageEnum = ['en', 'si', 'ta'] as const;
export type CareRequestLanguage = (typeof careRequestLanguageEnum)[number];

export const careRequests = mysqlTable(
  'care_requests',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    // Short, human-friendly handle staff and clients can read out on a call
    // ("request CR-7K2Q9M"). Not a secret and not used for lookups by clients.
    reference: varchar('reference', { length: 16 }).notNull().unique(),
    patientId: varchar('patient_id', { length: 36 }).notNull(),
    caregiverId: varchar('caregiver_id', { length: 36 }).notNull(),
    status: mysqlEnum('status', careRequestStatusEnum).notNull().default('NEW'),
    // What the client wrote when sending it. Shown to staff only.
    message: text('message'),
    // The language the client was using when they sent it; their update
    // notifications go out in it.
    language: mysqlEnum('language', careRequestLanguageEnum).notNull().default('en'),
    // The staff member handling it, if anyone has taken it.
    assignedToUserId: varchar('assigned_to_user_id', { length: 36 }),
    closeReason: mysqlEnum('close_reason', careRequestCloseReasonEnum),
    closedAt: datetime('closed_at'),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    // "patient:caregiver" while the request is open, NULL once it isn't. The
    // unique index on it is what stops a double-click or two tabs from opening
    // two requests for the same caregiver - a service-level check alone would
    // race. MySQL allows any number of NULLs in a unique index, so closed and
    // cancelled requests never collide. Same technique as caregivers.live_nic.
    openPairKey: varchar('open_pair_key', { length: 80 }).generatedAlwaysAs(
      sql`IF(status IN ('NEW', 'IN_PROGRESS'), CONCAT(patient_id, ':', caregiver_id), NULL)`,
      { mode: 'stored' },
    ),
  },
  (table) => ({
    patientIdx: index('care_requests_patient_idx').on(table.patientId),
    caregiverIdx: index('care_requests_caregiver_idx').on(table.caregiverId),
    statusIdx: index('care_requests_status_idx').on(table.status, table.createdAt),
    openPairUnique: uniqueIndex('care_requests_open_pair_unique').on(table.openPairKey),
  }),
);

/**
 * The staff-side history of a request: status moves, notes, assignment. Notes
 * are internal and never shown to the client or the caregiver.
 */
export const careRequestEventTypeEnum = ['CREATED', 'STATUS_CHANGED', 'NOTE', 'ASSIGNED', 'CANCELLED'] as const;
export type CareRequestEventType = (typeof careRequestEventTypeEnum)[number];

export const careRequestEvents = mysqlTable(
  'care_request_events',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    requestId: varchar('request_id', { length: 36 }).notNull(),
    type: mysqlEnum('type', careRequestEventTypeEnum).notNull(),
    fromStatus: mysqlEnum('from_status', careRequestStatusEnum),
    toStatus: mysqlEnum('to_status', careRequestStatusEnum),
    // Set on the STATUS_CHANGED event that closed the request.
    closeReason: mysqlEnum('close_reason', careRequestCloseReasonEnum),
    note: text('note'),
    // Who did it. For CREATED/CANCELLED this is the client's user id.
    actorUserId: varchar('actor_user_id', { length: 36 }),
    // Millisecond precision: a status change and a note in the same second
    // must still read back in the order they happened.
    createdAt: datetime('created_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
  },
  (table) => ({
    requestIdx: index('care_request_events_request_idx').on(table.requestId, table.createdAt),
  }),
);

/**
 * A client's shortlist ("Save this caregiver"). Keyed by the pair, so saving
 * twice is a no-op rather than a duplicate.
 */
export const savedCaregivers = mysqlTable(
  'saved_caregivers',
  {
    patientId: varchar('patient_id', { length: 36 }).notNull(),
    caregiverId: varchar('caregiver_id', { length: 36 }).notNull(),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    pk: primaryKey({ name: 'saved_caregivers_pk', columns: [table.patientId, table.caregiverId] }),
    caregiverIdx: index('saved_caregivers_caregiver_idx').on(table.caregiverId),
  }),
);
