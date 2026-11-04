import { Inject, Injectable, Logger, Optional } from '@nestjs/common';
import { randomUUID as uuid } from 'crypto';
import { and, count, desc, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import {
  DEFAULT_COMPANY_NAME,
  NOTIFICATION_LANGUAGES,
  notificationCategory,
  type NotificationCategory,
  type NotificationItem,
  type NotificationLanguage,
  type NotificationsPage,
  type NotificationText,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { notifications } from '../database/schema';
import { PushService, type PushExtras, type PushLanguage, type PushText } from '../push/push.service';
import { BrandingSettingsService } from '../branding/branding-settings.service';
import { withBrand } from '../common/branding/brand-text';

export const PAGE_SIZE = 20;
/** Inserts go in batches of this many rows (an announcement can reach thousands). */
const INSERT_CHUNK = 500;
/** The icon badge is worked out per person only for notices to a few people; an announcement doesn't wait on it. */
const BADGE_MAX_RECIPIENTS = 20;

export interface NotifyOptions {
  /** Defaults to the category of `path`. */
  category?: NotificationCategory;
  important?: boolean;
  /** An announcement's own link. */
  link?: string | null;
  announcementId?: string | null;
  /** false: the bell only, no push (a reminder in quiet hours). */
  push?: boolean;
}

/** Counts a person's open to-dos, for the icon badge. Set by the to-do service at start-up (it lives in a module that depends on this one). */
export type TodoCounter = (userId: string) => Promise<number>;

const MAX_TITLE = 300;
const MAX_BODY = 2000;
const clip = (s: string, max: number) => (s.length > max ? `${s.slice(0, max - 1)}…` : s);

/** The notice in all three languages, from the same builder the push uses. A language whose builder throws falls back to English. */
export function textFor(build: (lang: PushLanguage) => PushText): NotificationText | null {
  const out: Partial<NotificationText> = {};
  for (const lang of NOTIFICATION_LANGUAGES) {
    try {
      const t = build(lang);
      out[lang] = { title: clip(t.title.trim(), MAX_TITLE), body: clip(t.body.trim(), MAX_BODY) };
    } catch {
      /* filled from English below */
    }
  }
  const fallback = out.en ?? out.si ?? out.ta;
  if (!fallback) return null;
  for (const lang of NOTIFICATION_LANGUAGES) out[lang] ??= fallback;
  return out as NotificationText;
}

/** Cursor for the next page: the last row's time and id. */
const cursorOf = (row: { createdAt: Date; id: string }) => `${row.createdAt.toISOString()}_${row.id}`;
function parseCursor(cursor?: string | null): { at: Date; id: string } | null {
  if (!cursor) return null;
  const i = cursor.lastIndexOf('_');
  if (i < 0) return null;
  const at = new Date(cursor.slice(0, i));
  return Number.isNaN(at.getTime()) ? null : { at, id: cursor.slice(i + 1) };
}

/**
 * The bell. notify() is the one call every notifier makes for a client or
 * caregiver: it keeps the notice in the person's notifications, then sends
 * the push (as PushService did on its own before). WhatsApp and email stay in
 * the notifiers, unchanged.
 *
 * Fire and forget, like the push: notify() returns at once and never throws,
 * so a database or push problem can never block or change the main message.
 */
@Injectable()
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);
  private todoCounter: TodoCounter | null = null;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly push: PushService,
    @Optional() private readonly branding?: BrandingSettingsService,
  ) {}

  setTodoCounter(counter: TodoCounter) {
    this.todoCounter = counter;
  }

  notify(userIds: (string | null | undefined)[], build: (lang: PushLanguage) => PushText, path: string, label: string, opts: NotifyOptions = {}): void {
    void this.deliver(userIds, build, path, label, opts);
  }

  /** notify(), awaitable: resolves to the ids of the rows written (by user). Never throws. */
  async deliver(userIds: (string | null | undefined)[], build: (lang: PushLanguage) => PushText, path: string, label: string, opts: NotifyOptions = {}): Promise<Map<string, string>> {
    const ids = [...new Set(userIds.filter((v): v is string => Boolean(v)))];
    const written = new Map<string, string>();
    if (!ids.length) return written;
    try {
      const text = textFor(build);
      if (text) {
        const category = opts.category ?? notificationCategory(path);
        const now = new Date();
        const rows = ids.map((userId) => {
          const id = uuid();
          written.set(userId, id);
          return {
            id,
            userId,
            category,
            text,
            path: path.slice(0, 255),
            link: opts.link ?? null,
            important: Boolean(opts.important),
            announcementId: opts.announcementId ?? null,
            createdAt: now,
          };
        });
        for (let i = 0; i < rows.length; i += INSERT_CHUNK) await this.db.insert(notifications).values(rows.slice(i, i + INSERT_CHUNK));
      }
    } catch (err) {
      written.clear();
      this.logger.error(`Notification (${label}) not kept: ${(err as Error).message}`);
    }
    if (opts.push !== false) this.push.notify(ids, build, path, label, await this.extras(ids, written));
    return written;
  }

  /** Each person's icon badge and the row the push is about - for notices to a few people. */
  private async extras(ids: string[], written: Map<string, string>): Promise<PushExtras | undefined> {
    const out: PushExtras = new Map();
    for (const [userId, notificationId] of written) out.set(userId, { notificationId });
    if (ids.length <= BADGE_MAX_RECIPIENTS) {
      try {
        const unread = await this.unreadCounts(ids);
        for (const userId of ids) {
          const todos = this.todoCounter ? await this.todoCounter(userId).catch(() => 0) : 0;
          out.set(userId, { ...out.get(userId), badge: (unread.get(userId) ?? 0) + todos });
        }
      } catch {
        /* no badge this time */
      }
    }
    return out.size ? out : undefined;
  }

  // --- reading ------------------------------------------------------------------------

  async unreadCounts(userIds: string[]): Promise<Map<string, number>> {
    if (!userIds.length) return new Map();
    const rows = await this.db
      .select({ userId: notifications.userId, n: count() })
      .from(notifications)
      .where(and(inArray(notifications.userId, userIds), isNull(notifications.readAt)))
      .groupBy(notifications.userId);
    return new Map(rows.map((r) => [r.userId, Number(r.n)]));
  }

  async unreadCount(userId: string): Promise<number> {
    return (await this.unreadCounts([userId])).get(userId) ?? 0;
  }

  private async brand() {
    try {
      return this.branding ? await this.branding.companyName() : DEFAULT_COMPANY_NAME;
    } catch {
      return DEFAULT_COMPANY_NAME;
    }
  }

  /** The person's notifications, newest first, a page at a time, in `lang`. */
  async page(userId: string, lang: string | undefined, before?: string | null): Promise<NotificationsPage> {
    const cursor = parseCursor(before);
    const rows = await this.db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          cursor ? or(lt(notifications.createdAt, cursor.at), and(eq(notifications.createdAt, cursor.at), lt(notifications.id, cursor.id))) : undefined,
        ),
      )
      .orderBy(desc(notifications.createdAt), desc(notifications.id))
      .limit(PAGE_SIZE + 1);
    const brand = await this.brand();
    const language = (NOTIFICATION_LANGUAGES as readonly string[]).includes(lang ?? '') ? (lang as NotificationLanguage) : 'en';
    const items = rows.slice(0, PAGE_SIZE).map((r): NotificationItem => {
      const t = r.text[language] ?? r.text.en;
      return {
        id: r.id,
        category: r.category,
        title: withBrand(t.title, brand),
        body: withBrand(t.body, brand),
        path: r.path,
        link: r.link,
        important: r.important,
        createdAt: r.createdAt.toISOString(),
        readAt: r.readAt ? r.readAt.toISOString() : null,
      };
    });
    return { items, nextCursor: rows.length > PAGE_SIZE ? cursorOf(rows[PAGE_SIZE - 1]) : null };
  }

  /** Marks the person's own notifications read: some by id, those about some app paths, or all. Someone else's ids do nothing. */
  async markRead(userId: string, which: { ids?: string[]; paths?: string[]; all?: boolean }): Promise<number> {
    const filter = which.all
      ? undefined
      : which.ids?.length
        ? inArray(notifications.id, which.ids.slice(0, 200))
        : which.paths?.length
          ? inArray(notifications.path, which.paths.slice(0, 20))
          : null;
    if (filter === null) return 0;
    const [res] = await this.db
      .update(notifications)
      .set({ readAt: new Date() })
      .where(and(eq(notifications.userId, userId), isNull(notifications.readAt), filter));
    return Number((res as { affectedRows?: number })?.affectedRows ?? 0);
  }

  /** Housekeeping: notifications older than `days` go. */
  async deleteOlderThan(days: number, now = new Date()): Promise<number> {
    const cutoff = new Date(now.getTime() - days * 86_400_000);
    const [res] = await this.db.delete(notifications).where(lt(notifications.createdAt, cutoff));
    return Number((res as { affectedRows?: number })?.affectedRows ?? 0);
  }

  /** How many of an announcement's recipients have opened it. */
  async readCountsFor(announcementIds: string[]): Promise<Map<string, number>> {
    if (!announcementIds.length) return new Map();
    const rows = await this.db
      .select({ id: notifications.announcementId, n: sql<number>`SUM(CASE WHEN ${notifications.readAt} IS NULL THEN 0 ELSE 1 END)` })
      .from(notifications)
      .where(inArray(notifications.announcementId, announcementIds))
      .groupBy(notifications.announcementId);
    return new Map(rows.map((r) => [r.id ?? '', Number(r.n ?? 0)]));
  }
}
