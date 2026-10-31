import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy, Optional } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID as uuid } from 'crypto';
import { and, eq, inArray, isNull } from 'drizzle-orm';
import { DRIZZLE, type Database } from '../database/database.module';
import { deviceTokens, type DevicePlatform } from '../database/schema';
import { BrandingSettingsService } from '../branding/branding-settings.service';
import { withBrand } from '../common/branding/brand-text';
import { DEFAULT_COMPANY_NAME } from '@care-platform/shared';

export type PushLanguage = 'en' | 'si' | 'ta';
export interface PushText {
  title: string;
  body: string;
}

const SEND_URL = 'https://exp.host/--/api/v2/push/send';
const RECEIPTS_URL = 'https://exp.host/--/api/v2/push/getReceipts';
/** Expo takes at most 100 messages per send and 1000 ids per receipts call. */
export const SEND_CHUNK = 100;
const RECEIPT_CHUNK = 1000;
/** Expo has receipts ready within about 15 minutes of a send. */
const RECEIPT_DELAY_MS = 15 * 60_000;
const RECEIPT_TICK_MS = 5 * 60_000;
/** Receipts not checked after this long are dropped (Expo keeps them for a day). */
const RECEIPT_GIVE_UP_MS = 12 * 60 * 60_000;
/** Memory cap on tickets waiting for a receipt check; past it the oldest are dropped. */
const MAX_PENDING = 50_000;

export interface ExpoMessage {
  to: string;
  title: string;
  body: string;
  sound: 'default';
  /** The Android channel the app creates on start-up. */
  channelId: 'default';
  data: { path: string };
}

type Ticket = { status: 'ok'; id: string } | { status: 'error'; message?: string; details?: { error?: string } };
type Receipt = { status: 'ok' } | { status: 'error'; message?: string; details?: { error?: string } };

/** The one error that means "this token is dead": the app was uninstalled or the token replaced. */
export const isDeadToken = (r: Ticket | Receipt | undefined) => r?.status === 'error' && r.details?.error === 'DeviceNotRegistered';

/** A push for each of the person's phones, each in that phone's app language. */
export function messagesFor(
  devices: { expoPushToken: string; locale: PushLanguage }[],
  build: (lang: PushLanguage) => PushText,
  path: string,
  brand: string,
): ExpoMessage[] {
  const byLang = new Map<PushLanguage, PushText>();
  return devices.map((d) => {
    let text = byLang.get(d.locale);
    if (!text) {
      const t = build(d.locale);
      // Message texts name the company as {brand}; see common/branding/brand-text.ts.
      text = { title: withBrand(t.title, brand).trim(), body: withBrand(t.body, brand).trim() };
      byLang.set(d.locale, text);
    }
    return { to: d.expoPushToken, title: text.title, body: text.body, sound: 'default', channelId: 'default', data: { path } };
  });
}

/** A push from a notice written in all three languages (the caregiver notices). */
export function fromBlocks(blocks: readonly { lang: PushLanguage; heading: string; body: string }[], lang: PushLanguage): PushText {
  const b = blocks.find((x) => x.lang === lang) ?? blocks.find((x) => x.lang === 'en') ?? blocks[0];
  return { title: b?.heading ?? '', body: b?.body ?? '' };
}

/** A push from a notice written in one language (the client notices). */
export const fromNotice = (t: { heading: string; body: string }): PushText => ({ title: t.heading, body: t.body });

export const chunk = <T>(items: T[], size: number): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
};

/**
 * Push notifications to the mobile app, through Expo's push service (which
 * delivers via Apple's and Google's). Always an extra: every notifier still
 * sends its WhatsApp or email message exactly as before, and calls notify()
 * for the people who also have the app. notify() never throws and never makes
 * the caller wait on Expo - a push problem can't block or change another send.
 *
 * Tokens Expo reports as dead, at send time or in the delivery receipt read
 * about 15 minutes later, are revoked so they aren't tried again. Pending
 * receipts are kept in memory: after a restart the unchecked ones are simply
 * not checked, and the next send to a dead token reports it straight away.
 */
@Injectable()
export class PushService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(PushService.name);
  private timer: NodeJS.Timeout | null = null;
  /** Ticket id -> the token it was sent to, and when. */
  private readonly pending = new Map<string, { token: string; sentAt: number }>();
  /** The HTTP call, replaceable in tests. */
  http: (url: string, init: RequestInit) => Promise<Response> = (url, init) => fetch(url, init);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
    @Optional() private readonly branding?: BrandingSettingsService,
  ) {}

  onApplicationBootstrap() {
    if (this.config.get<string>('NODE_ENV') === 'test' || !this.enabled()) return;
    this.timer = setInterval(() => void this.checkReceipts().catch((e) => this.logger.warn(`Push receipts check failed: ${(e as Error).message}`)), RECEIPT_TICK_MS);
    this.timer.unref();
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private enabled() {
    return this.config.get<string>('PUSH_ENABLED') !== 'false';
  }

  // --- devices -------------------------------------------------------------------------

  /**
   * Registers this phone for the signed-in person, or refreshes it. A token
   * already registered to someone else (another person signed in on the same
   * phone before) moves to this person.
   */
  async register(userId: string, d: { expoPushToken: string; platform: DevicePlatform; appVersion?: string | null; locale?: PushLanguage | null }) {
    const now = new Date();
    const fields = { userId, platform: d.platform, appVersion: d.appVersion ?? null, locale: d.locale ?? 'en', lastSeenAt: now, revokedAt: null };
    const [existing] = await this.db.select({ id: deviceTokens.id }).from(deviceTokens).where(eq(deviceTokens.expoPushToken, d.expoPushToken)).limit(1);
    if (existing) {
      await this.db.update(deviceTokens).set(fields).where(eq(deviceTokens.id, existing.id));
      return { id: existing.id };
    }
    const id = uuid();
    try {
      await this.db.insert(deviceTokens).values({ id, expoPushToken: d.expoPushToken, ...fields, createdAt: now });
      return { id };
    } catch (err) {
      // Two registrations of a new token at once: the other one won; take it over.
      const [row] = await this.db.select({ id: deviceTokens.id }).from(deviceTokens).where(eq(deviceTokens.expoPushToken, d.expoPushToken)).limit(1);
      if (!row) throw err;
      await this.db.update(deviceTokens).set(fields).where(eq(deviceTokens.id, row.id));
      return { id: row.id };
    }
  }

  /** The person removes one of their phones (the app does this on sign-out). Someone else's id does nothing. */
  async revoke(userId: string, id: string) {
    await this.db
      .update(deviceTokens)
      .set({ revokedAt: new Date() })
      .where(and(eq(deviceTokens.id, id), eq(deviceTokens.userId, userId), isNull(deviceTokens.revokedAt)));
  }

  /** Signing out ends every session, so every phone stops getting this person's alerts. */
  async revokeAllForUser(userId: string) {
    await this.db.update(deviceTokens).set({ revokedAt: new Date() }).where(and(eq(deviceTokens.userId, userId), isNull(deviceTokens.revokedAt)));
  }

  private async revokeTokens(tokens: string[]) {
    if (!tokens.length) return;
    await this.db.update(deviceTokens).set({ revokedAt: new Date() }).where(and(inArray(deviceTokens.expoPushToken, tokens), isNull(deviceTokens.revokedAt)));
    this.logger.log(`Push: revoked ${tokens.length} token(s) Expo reports as no longer registered.`);
  }

  // --- sending -------------------------------------------------------------------------

  /**
   * Sends a push to every phone these people have the app on, in each phone's
   * language, opening `path` in the app when tapped. Fire and forget: returns
   * at once, never throws. `label` names the notice in the logs.
   */
  notify(userIds: (string | null | undefined)[], build: (lang: PushLanguage) => PushText, path: string, label: string): void {
    void this.send(userIds, build, path, label);
  }

  /** notify(), awaitable: resolves to the number of phones Expo accepted the push for. Never throws. */
  async send(userIds: (string | null | undefined)[], build: (lang: PushLanguage) => PushText, path: string, label: string): Promise<number> {
    try {
      const ids = [...new Set(userIds.filter((v): v is string => Boolean(v)))];
      if (!ids.length || !this.enabled()) return 0;
      const devices = await this.db
        .select({ expoPushToken: deviceTokens.expoPushToken, locale: deviceTokens.locale })
        .from(deviceTokens)
        .where(and(inArray(deviceTokens.userId, ids), isNull(deviceTokens.revokedAt)));
      if (!devices.length) return 0;

      const brand = this.branding ? await this.branding.companyName() : DEFAULT_COMPANY_NAME;
      const messages = messagesFor(devices, build, path, brand);
      let accepted = 0;
      const dead: string[] = [];
      for (const batch of chunk(messages, SEND_CHUNK)) {
        const tickets = await this.post<{ data?: Ticket[] }>(SEND_URL, batch);
        tickets?.data?.forEach((t, i) => {
          const token = batch[i]?.to;
          if (!token) return;
          if (t.status === 'ok') {
            accepted++;
            this.remember(t.id, token);
          } else if (isDeadToken(t)) dead.push(token);
          else this.logger.warn(`Push (${label}) refused: ${t.message ?? t.details?.error ?? 'unknown error'}`);
        });
      }
      await this.revokeTokens(dead);
      return accepted;
    } catch (err) {
      this.logger.error(`Push (${label}) failed: ${(err as Error).message}`);
      return 0;
    }
  }

  private remember(ticketId: string, token: string) {
    if (this.pending.size >= MAX_PENDING) {
      const oldest = this.pending.keys().next().value;
      if (oldest !== undefined) this.pending.delete(oldest);
    }
    this.pending.set(ticketId, { token, sentAt: Date.now() });
  }

  /** Reads the delivery receipts that are due and revokes the tokens Expo reports as dead. */
  async checkReceipts(now = Date.now()) {
    const due = [...this.pending.entries()].filter(([, p]) => now - p.sentAt >= RECEIPT_DELAY_MS);
    if (!due.length) return;
    const dead: string[] = [];
    for (const batch of chunk(due, RECEIPT_CHUNK)) {
      const res = await this.post<{ data?: Record<string, Receipt> }>(RECEIPTS_URL, { ids: batch.map(([id]) => id) });
      for (const [id, p] of batch) {
        const receipt = res?.data?.[id];
        if (receipt) {
          if (isDeadToken(receipt)) dead.push(p.token);
          else if (receipt.status === 'error') this.logger.warn(`Push not delivered: ${receipt.message ?? receipt.details?.error ?? 'unknown error'}`);
          this.pending.delete(id);
        } else if (now - p.sentAt > RECEIPT_GIVE_UP_MS) {
          this.pending.delete(id);
        }
      }
    }
    await this.revokeTokens([...new Set(dead)]);
  }

  /** How many sends are waiting for a receipt check (for tests and diagnostics). */
  get pendingReceipts() {
    return this.pending.size;
  }

  private async post<T>(url: string, body: unknown): Promise<T | null> {
    const headers: Record<string, string> = { 'Content-Type': 'application/json', Accept: 'application/json' };
    const token = this.config.get<string>('EXPO_ACCESS_TOKEN');
    if (token) headers.Authorization = `Bearer ${token}`;
    const res = await this.http(url, { method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    if (!res.ok) {
      this.logger.warn(`Expo push service answered ${res.status}: ${(await res.text().catch(() => '')).slice(0, 300)}`);
      return null;
    }
    return (await res.json()) as T;
  }
}
