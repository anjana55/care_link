import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, eq, gte, inArray, lte, ne } from 'drizzle-orm';
import { toColombo } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { bookingShifts, bookings, reviewRequests } from '../database/schema';
import { ReviewSettingsService } from './review-settings.service';
import { ReviewStore } from './review-store.service';
import { ReviewsNotifier } from './reviews-notifier.service';
import { dueForAsk, dueForReminder } from './review-rules';

/** How often the sweep wakes. */
const TICK_MS = 60 * 60_000;
/** Asks go out in the daytime only, Colombo time: from this hour... */
const FIRST_HOUR = 10;
/** ...up to (not including) this one. */
const LAST_HOUR = 19;
/**
 * Only work that ended recently is asked about. Older bookings can still be
 * rated from the account, but switching ratings on must not message every
 * client with a booking from the last three months.
 */
const ASK_RECENT_DAYS = 14;
const BOOKINGS_PER_TICK = 300;

const isDuplicate = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e.code ?? e.cause?.code) === 'ER_DUP_ENTRY';
};

/**
 * Asks clients to rate their caregivers: once when a caregiver's work on a
 * booking is over (or after their first week on a long one), and one reminder
 * three days later if they still haven't. Never more than those two per
 * booking and caregiver.
 *
 * Inserting the review_requests row is the lock: a second run, or a second API
 * instance, hits the unique key and skips. A row is written before the message
 * is sent, so a crash between the two loses a message rather than doubling one.
 */
@Injectable()
export class ReviewRequestSweepService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(ReviewRequestSweepService.name);
  private timers: NodeJS.Timeout[] = [];
  private running = false;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly settings: ReviewSettingsService,
    private readonly store: ReviewStore,
    private readonly notifier: ReviewsNotifier,
  ) {}

  onApplicationBootstrap() {
    if (this.config.get<string>('NODE_ENV') === 'test' || this.config.get<string>('REVIEW_REQUESTS_ENABLED') === 'false') return;
    const tick = () => void this.tick().catch((err) => this.logger.warn(`Review request sweep failed: ${(err as Error).message}`));
    const first = setTimeout(tick, 2 * 60_000);
    const every = setInterval(tick, TICK_MS);
    first.unref();
    every.unref();
    this.timers = [first, every];
  }

  onModuleDestroy() {
    this.timers.forEach((t) => clearTimeout(t));
  }

  async tick(now = new Date()): Promise<number> {
    if (this.running) return 0;
    const hour = Number(toColombo(now).time.slice(0, 2));
    if (hour < FIRST_HOUR || hour >= LAST_HOUR) return 0;
    this.running = true;
    try {
      const s = await this.settings.getResolved();
      if (!s.enabled) return 0;
      const sent = await this.run(now, s.windowDays);
      if (sent) this.logger.log(`Reviews: asked ${sent} clients to rate`);
      return sent;
    } finally {
      this.running = false;
    }
  }

  /** One pass: every booking with work that ended recently. Returns the messages sent. */
  async run(now: Date, windowDays: number): Promise<number> {
    const since = new Date(now.getTime() - ASK_RECENT_DAYS * 86_400_000);
    const recent = await this.db
      .selectDistinct({ bookingId: bookings.id, patientId: bookings.patientId, reference: bookings.reference, language: bookings.language })
      .from(bookingShifts)
      .innerJoin(bookings, eq(bookingShifts.bookingId, bookings.id))
      .where(
        and(
          ne(bookings.status, 'DRAFT'),
          inArray(bookingShifts.status, ['SCHEDULED', 'COMPLETED']),
          lte(bookingShifts.endsAt, now),
          gte(bookingShifts.endsAt, since),
        ),
      )
      .limit(BOOKINGS_PER_TICK);
    if (!recent.length) return 0;

    const asked = await this.db.select().from(reviewRequests).where(inArray(reviewRequests.bookingId, recent.map((b) => b.bookingId)));
    let sent = 0;
    const byPatient = new Map<string, typeof recent>();
    for (const b of recent) byPatient.set(b.patientId, [...(byPatient.get(b.patientId) ?? []), b]);

    for (const [patientId, list] of byPatient) {
      const entries = await this.store.entriesForClient(patientId, list.map((b) => b.bookingId), now, windowDays);
      for (const b of list) {
        for (const e of entries.get(b.bookingId) ?? []) {
          if (e.review || e.lastWorkedAt.getTime() < since.getTime()) continue;
          const mine = asked.filter((a) => a.bookingId === b.bookingId && a.caregiverId === e.caregiverId);
          const ask = mine.find((a) => a.stage === 'ASK');
          let stage: 'ASK' | 'REMINDER' | null = null;
          if (!ask && dueForAsk(e, now)) stage = 'ASK';
          else if (ask && !mine.some((a) => a.stage === 'REMINDER') && dueForReminder(ask.sentAt, e, now)) stage = 'REMINDER';
          if (!stage) continue;
          if (!(await this.claim(b.bookingId, e.caregiverId, stage, now))) continue;
          const ok = await this.notifier.askClient(stage, { patientId, bookingId: b.bookingId, reference: b.reference, language: b.language, caregiverPublicId: e.caregiverPublicId });
          if (ok) sent++;
        }
      }
    }
    return sent;
  }

  private async claim(bookingId: string, caregiverId: string, stage: 'ASK' | 'REMINDER', now: Date): Promise<boolean> {
    try {
      await this.db.insert(reviewRequests).values({ bookingId, caregiverId, stage, sentAt: now });
      return true;
    } catch (err) {
      if (isDuplicate(err)) return false;
      throw err;
    }
  }
}
