import { mysqlTable, varchar, datetime, mysqlEnum, boolean, int, index, uniqueIndex, json } from 'drizzle-orm/mysql-core';
import { sql } from 'drizzle-orm';
import { ANNOUNCEMENT_AUDIENCES, NOTIFICATION_CATEGORIES, type NotificationText } from '@care-platform/shared';

/**
 * The bell's history: one row per person per notice. Written by
 * NotificationsService.notify() - the same call that sends the push - so
 * every notice a client or caregiver is sent also shows in the app and on
 * the website, read or unread.
 *
 * `text` holds all three languages, written at send time from the same
 * message functions as the push, with the company name left as {brand}
 * (filled in when read, so a rebrand shows at once). `path` is the app path
 * the push opens; the website maps it with webPathFor().
 *
 * Rows go when the person's account is erased, and after the retention
 * period in Settings > Notifications.
 */
export const notifications = mysqlTable(
  'notifications',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 }).notNull(),
    category: mysqlEnum('category', NOTIFICATION_CATEGORIES).notNull(),
    text: json('text').$type<NotificationText>().notNull(),
    path: varchar('path', { length: 255 }).notNull(),
    link: varchar('link', { length: 500 }),
    important: boolean('important').notNull().default(false),
    announcementId: varchar('announcement_id', { length: 36 }),
    createdAt: datetime('created_at', { fsp: 3 }).notNull().default(sql`CURRENT_TIMESTAMP(3)`),
    readAt: datetime('read_at'),
  },
  (t) => ({
    userCreatedIdx: index('notifications_user_created_idx').on(t.userId, t.createdAt),
    userReadIdx: index('notifications_user_read_idx').on(t.userId, t.readAt),
    announcementIdx: index('notifications_announcement_idx').on(t.announcementId),
    createdIdx: index('notifications_created_idx').on(t.createdAt),
  }),
);

/**
 * The reminder lock: one row per person, to-do and stage, written before the
 * reminder is sent, so a sweep that runs twice (a restart, a second API copy)
 * can never send it twice. `item_key` is the to-do's key; digests log every
 * item they mention.
 */
export const reminderSends = mysqlTable(
  'reminder_sends',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    userId: varchar('user_id', { length: 36 }).notNull(),
    itemKey: varchar('item_key', { length: 160 }).notNull(),
    stage: varchar('stage', { length: 24 }).notNull(),
    sentAt: datetime('sent_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    once: uniqueIndex('reminder_sends_once').on(t.userId, t.itemKey, t.stage),
    userSentIdx: index('reminder_sends_user_sent_idx').on(t.userId, t.sentAt),
  }),
);

/** A message from the office to every client, every caregiver, or both. Published into each person's notifications. */
export const announcements = mysqlTable(
  'announcements',
  {
    id: varchar('id', { length: 36 }).primaryKey(),
    audience: mysqlEnum('audience', ANNOUNCEMENT_AUDIENCES).notNull(),
    text: json('text').$type<NotificationText>().notNull(),
    link: varchar('link', { length: 500 }),
    important: boolean('important').notNull().default(false),
    sendPush: boolean('send_push').notNull().default(true),
    sendWhatsapp: boolean('send_whatsapp').notNull().default(false),
    createdByUserId: varchar('created_by_user_id', { length: 36 }),
    publishedAt: datetime('published_at'),
    recipients: int('recipients').notNull().default(0),
    createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  },
  (t) => ({
    createdIdx: index('announcements_created_idx').on(t.createdAt),
  }),
);

/** Settings > Notifications: one row, id 'default'. */
export const notificationSettings = mysqlTable('notification_settings', {
  id: varchar('id', { length: 36 }).primaryKey(),
  remindersEnabled: boolean('reminders_enabled').notNull().default(true),
  quietStartHour: int('quiet_start_hour').notNull().default(21),
  quietEndHour: int('quiet_end_hour').notNull().default(7),
  dailyReminderCap: int('daily_reminder_cap').notNull().default(2),
  retentionDays: int('retention_days').notNull().default(180),
  updatedBy: varchar('updated_by', { length: 36 }),
  createdAt: datetime('created_at').notNull().default(sql`CURRENT_TIMESTAMP`),
  updatedAt: datetime('updated_at').notNull().default(sql`CURRENT_TIMESTAMP`),
});
