import { mysqlTable, varchar, datetime, mysqlEnum, decimal, index, uniqueIndex } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { CARE_OFFER_DECLINE_REASONS, CARE_OFFER_STATUSES } from '@care-platform/shared';
import { rateTypeEnum } from './bookings.schema';

/**
 * A care request offered to one caregiver. Several caregivers can hold an
 * offer for the same request; the first to accept takes it.
 *
 * The rates are a snapshot taken when the offer was sent (from the
 * caregiver's own rate and the fee at that moment), so what the caregiver
 * agreed to cannot shift under them afterwards. Null rates mean "to be
 * agreed": the office prices the booking by hand.
 *
 * `open_key` is "request:caregiver" while the offer is waiting and NULL
 * otherwise, so the unique index allows one waiting offer per caregiver per
 * request and any number of finished ones (the same technique as
 * care_requests.open_pair_key).
 */
export const requestOffers = mysqlTable(
  'request_offers',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    requestId: varchar('request_id', { length: 36 }).notNull(),
    caregiverId: varchar('caregiver_id', { length: 36 }).notNull(),
    status: mysqlEnum('status', CARE_OFFER_STATUSES).notNull().default('OFFERED'),
    rateType: mysqlEnum('rate_type', rateTypeEnum),
    payRate: decimal('pay_rate', { precision: 10, scale: 2, mode: 'number' }),
    clientRate: decimal('client_rate', { precision: 10, scale: 2, mode: 'number' }),
    /** From the office to the caregiver. Staff are told not to put client details in it. */
    note: varchar('note', { length: 500 }),
    declineReason: mysqlEnum('decline_reason', CARE_OFFER_DECLINE_REASONS),
    /** The staff member who sent it, or the matching agent's own user. */
    sentByUserId: varchar('sent_by_user_id', { length: 36 }),
    expiresAt: datetime('expires_at', { fsp: 3 }).notNull(),
    respondedAt: datetime('responded_at', { fsp: 3 }),
    createdAt: datetime('created_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    openKey: varchar('open_key', { length: 80 }).generatedAlwaysAs(sql`IF(status = 'OFFERED', CONCAT(request_id, ':', caregiver_id), NULL)`, { mode: 'stored' }),
  },
  (t) => ({
    requestIdx: index('request_offers_request_idx').on(t.requestId, t.createdAt),
    caregiverIdx: index('request_offers_caregiver_idx').on(t.caregiverId, t.status, t.expiresAt),
    openUnique: uniqueIndex('request_offers_open_unique').on(t.openKey),
  }),
);
