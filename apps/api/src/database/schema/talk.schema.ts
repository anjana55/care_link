import { mysqlTable, varchar, text, datetime, mysqlEnum, index } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { TALK_ABOUT_TYPES, TALK_CONTACT_METHODS } from '@care-platform/shared';

/** "Talk to a person": a client or caregiver asked for a member of staff. */
export const talkRequests = mysqlTable(
  'talk_requests',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 }).notNull(),
    role: mysqlEnum('role', ['CLIENT', 'CAREGIVER']).notNull(),
    aboutType: mysqlEnum('about_type', TALK_ABOUT_TYPES),
    aboutId: varchar('about_id', { length: 36 }),
    message: text('message').notNull(),
    contact: mysqlEnum('contact', TALK_CONTACT_METHODS).notNull(),
    status: mysqlEnum('status', ['OPEN', 'HANDLED']).notNull().default('OPEN'),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    handledAt: datetime('handled_at'),
    handledByUserId: varchar('handled_by_user_id', { length: 36 }),
    staffNote: varchar('staff_note', { length: 500 }),
  },
  (table) => ({
    userIdx: index('talk_requests_user_idx').on(table.userId, table.status),
    statusIdx: index('talk_requests_status_idx').on(table.status, table.createdAt),
  }),
);
