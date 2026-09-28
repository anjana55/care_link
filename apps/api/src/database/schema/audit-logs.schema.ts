import { mysqlTable, varchar, json, datetime, index } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';

export const auditLogs = mysqlTable(
  'audit_logs',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 }),
    action: varchar('action', { length: 100 }).notNull(),
    entityType: varchar('entity_type', { length: 100 }).notNull(),
    entityId: varchar('entity_id', { length: 36 }),
    // Never store sensitive document contents or passwords here.
    metadata: json('metadata'),
    ipAddress: varchar('ip_address', { length: 45 }),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    entityIdx: index('audit_logs_entity_idx').on(table.entityType, table.entityId),
    userIdx: index('audit_logs_user_idx').on(table.userId),
    createdIdx: index('audit_logs_created_idx').on(table.createdAt),
  }),
);
