import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID as uuid } from 'crypto';
import { and, eq, inArray, isNull, lt, ne, notInArray, or, sql } from 'drizzle-orm';
import { CARE_DUE_SHIFT_STATUSES, careCutOff, careOccurrences, colomboToday, toColombo } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { bookingShifts, bookings, careActivityRecords, carePlanActivities, carePlans, careShiftReviews, patients, users } from '../database/schema';
import { EmailService } from '../email/email.service';
import { WhatsappSettingsService } from '../whatsapp/whatsapp-settings.service';
import { WhatsappProviderService } from '../whatsapp/whatsapp-provider.service';
import { normalizePhone } from '../common/utils/phone.util';
import { chooseClientChannel } from '../care-requests/care-request-notifier.service';
import { CLIENT_FOOTER } from '../care-requests/notification-messages';
import { rowToFields, type ActivityRow } from './activity-rows';
import { careReminderNotice } from './care-messages';
import { CarePlansService } from './care-plans.service';
import { PushService, fromNotice } from '../push/push.service';

/** How often the sweep wakes. */
const TICK_MS = 5 * 60_000;
/** Shifts finalised per batch, and batches per tick - a backlog drains over a few ticks. */
const BATCH = 200;
const MAX_BATCHES = 10;
/** The evening reminder goes out once, in this Colombo hour. */
const REMINDER_HOUR = 20;

const isDuplicate = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e.code ?? e.cause?.code) === 'ER_DUP_ENTRY';
};

/**
 * The midnight rule, and the evening reminder.
 *
 * Every few minutes it finalises each shift whose cut-off (midnight after the
 * day it ends, Colombo) has passed: every item nobody marked is recorded as
 * Done, source AUTO. It works by "cut-off has passed and not finalised yet"
 * rather than "yesterday", so a server that was down at midnight catches up.
 * Inserting the shift's care_shift_reviews row is the lock: a second run, or a
 * second API instance, finds it and skips the shift.
 *
 * A finalised shift later marked missed or cancelled has its AUTO items voided
 * and its review removed; if it goes back to scheduled or completed it is
 * finalised again on the next tick.
 */
@Injectable()
export class CarePlanSweepService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(CarePlanSweepService.name);
  private timers: NodeJS.Timeout[] = [];
  private running = false;
  private lastReminderDay: string | null = null;

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly plans: CarePlansService,
    private readonly email: EmailService,
    private readonly whatsappSettings: WhatsappSettingsService,
    private readonly whatsapp: WhatsappProviderService,
    private readonly push: PushService,
  ) {}

  onApplicationBootstrap() {
    if (this.config.get<string>('NODE_ENV') === 'test' || this.config.get<string>('CARE_PLAN_SWEEP_ENABLED') === 'false') return;
    const tick = () => void this.tick().catch((err) => this.logger.warn(`Care plan sweep failed: ${(err as Error).message}`));
    const first = setTimeout(tick, 60_000);
    const every = setInterval(tick, TICK_MS);
    first.unref();
    every.unref();
    this.timers = [first, every];
  }

  onModuleDestroy() {
    this.timers.forEach((t) => clearTimeout(t));
  }

  async tick(now = new Date()) {
    if (this.running) return;
    this.running = true;
    try {
      await this.reconcile();
      const finalised = await this.finalizeDue(now);
      if (finalised) this.logger.log(`Care plans: finalised ${finalised} shifts`);
      await this.maybeRemind(now);
    } finally {
      this.running = false;
    }
  }

  /** Finalised shifts that are now missed, cancelled or gone: void what the sweep filled in. */
  async reconcile() {
    const stale = await this.db
      .select({ shiftId: careShiftReviews.shiftId })
      .from(careShiftReviews)
      .leftJoin(bookingShifts, eq(bookingShifts.id, careShiftReviews.shiftId))
      .where(or(isNull(bookingShifts.id), notInArray(bookingShifts.status, [...CARE_DUE_SHIFT_STATUSES])))
      .limit(500);
    for (const { shiftId } of stale) {
      await this.db.transaction(async (tx) => {
        await tx
          .update(careActivityRecords)
          .set({ status: 'VOID' })
          .where(and(eq(careActivityRecords.shiftId, shiftId), eq(careActivityRecords.source, 'AUTO')));
        await tx.delete(careShiftReviews).where(eq(careShiftReviews.shiftId, shiftId));
      });
    }
    return stale.length;
  }

  /** Shifts past their cut-off with no review yet, on bookings that have a plan. */
  async finalizeDue(now = new Date()) {
    const today = colomboToday(now);
    let total = 0;
    for (let batch = 0; batch < MAX_BATCHES; batch++) {
      const due = await this.db
        .select({ shiftId: bookingShifts.id, bookingId: bookingShifts.bookingId, startsAt: bookingShifts.startsAt, endsAt: bookingShifts.endsAt, planId: carePlans.id })
        .from(bookingShifts)
        .innerJoin(bookings, eq(bookings.id, bookingShifts.bookingId))
        .innerJoin(carePlans, eq(carePlans.bookingId, bookingShifts.bookingId))
        .leftJoin(careShiftReviews, eq(careShiftReviews.shiftId, bookingShifts.id))
        .where(
          and(
            isNull(careShiftReviews.shiftId),
            inArray(bookingShifts.status, [...CARE_DUE_SHIFT_STATUSES]),
            ne(bookings.status, 'DRAFT'),
            lt(bookingShifts.endsAt, now),
            // The Colombo day the shift ends (a midnight end belongs to the day before) is over.
            sql`DATE(DATE_ADD(DATE_SUB(${bookingShifts.endsAt}, INTERVAL 1 MINUTE), INTERVAL 330 MINUTE)) < ${today}`,
          ),
        )
        .limit(BATCH);
      for (const s of due) total += (await this.finalizeShift(s, now)) ? 1 : 0;
      if (due.length < BATCH) break;
    }
    return total;
  }

  /** Records Done (AUTO) for every unmarked item on one shift. False when another run got there first. */
  async finalizeShift(s: { shiftId: string; bookingId: string; startsAt: Date; endsAt: Date; planId: string }, now = new Date()): Promise<boolean> {
    try {
      await this.db.transaction(async (tx) => {
        await tx.insert(careShiftReviews).values({ shiftId: s.shiftId, bookingId: s.bookingId, cutOffAt: careCutOff(s.endsAt), finalizedAt: now });
        const acts = await tx.select().from(carePlanActivities).where(eq(carePlanActivities.planId, s.planId));
        const occ = careOccurrences(
          acts.map((a) => ({ ...rowToFields(a as unknown as ActivityRow), id: a.id, sortOrder: a.sortOrder, effectiveFrom: a.effectiveFrom, effectiveTo: a.effectiveTo })),
          s,
        );
        if (!occ.length) return;
        const existing = await tx.select().from(careActivityRecords).where(eq(careActivityRecords.shiftId, s.shiftId));
        const critical = new Map(acts.map((a) => [a.id, a.isCritical]));
        const fresh: (typeof careActivityRecords.$inferInsert)[] = [];
        for (const o of occ) {
          const rec = existing.find((r) => r.planActivityId === o.activityId && r.dueKey === o.dueKey);
          if (!rec) {
            fresh.push({
              id: uuid(),
              planActivityId: o.activityId,
              shiftId: s.shiftId,
              bookingId: s.bookingId,
              dueKey: o.dueKey,
              dueDate: o.dueDate,
              status: 'DONE' as const,
              source: 'AUTO' as const,
              isCritical: critical.get(o.activityId) ?? false,
              recordedAt: now,
            });
          } else if (rec.status === 'VOID') {
            await tx
              .update(careActivityRecords)
              .set({ status: 'DONE', source: 'AUTO', reason: null, recordedByUserId: null, recordedAt: now })
              .where(eq(careActivityRecords.id, rec.id));
          }
        }
        if (fresh.length) await tx.insert(careActivityRecords).values(fresh);
      });
      return true;
    } catch (err) {
      if (isDuplicate(err)) return false;
      throw err;
    }
  }

  // --- evening reminder ----------------------------------------------------------------

  private async maybeRemind(now: Date) {
    const { date, time } = toColombo(now);
    if (Number(time.slice(0, 2)) !== REMINDER_HOUR || this.lastReminderDay === date) return;
    this.lastReminderDay = date;
    const open = await this.plans.openItemsForReminders(now);
    for (const o of open) await this.remind(o.patientId, o.language, o.count);
    if (open.length) this.logger.log(`Care plans: reminded ${open.length} clients`);
  }

  private publicUrl(path: string) {
    return `${(this.config.get<string>('PUBLIC_WEB_URL') ?? 'http://localhost:3002').replace(/\/+$/, '')}${path}`;
  }

  /** One client, one message: never throws. */
  private async remind(patientId: string, language: 'en' | 'si' | 'ta', count: number) {
    try {
      const [p] = await this.db
        .select({ userId: patients.userId, phone: patients.phone, preferred: patients.preferredContactMethod, email: users.email, userPhone: users.phone })
        .from(patients)
        .innerJoin(users, eq(users.id, patients.userId))
        .where(eq(patients.id, patientId))
        .limit(1);
      if (!p) return;
      const wa = await this.whatsappSettings.getResolved();
      const cc = await this.whatsappSettings.getDefaultCountryCode();
      const phone = p.userPhone ?? normalizePhone(p.phone, cc);
      const canWa = Boolean(phone) && this.whatsapp.canSendUpdates(wa);
      const text = careReminderNotice(language, count);
      // Push to the app as well - in addition to the message below, never instead of it.
      this.push.notify([p.userId], (lang) => fromNotice(careReminderNotice(lang, count)), '/care', 'care plan reminder');
      const channel = chooseClientChannel({ hasEmail: Boolean(p.email), canWhatsapp: canWa, preferred: p.preferred });
      if (channel === 'WHATSAPP') {
        await this.whatsapp.sendUpdate(wa, phone!, language, `${text.heading}. ${text.body}`);
      } else if (channel === 'EMAIL') {
        await this.email.sendNotificationEmail(
          p.email!,
          {
            subject: text.subject,
            blocks: [{ lang: language, heading: text.heading, paragraphs: [text.body] }],
            cta: { label: text.cta, url: this.publicUrl('/account/bookings') },
            footer: CLIENT_FOOTER[language],
          },
          'care plan reminder',
        );
      }
    } catch (err) {
      this.logger.error(`Care plan reminder failed: ${(err as Error).message}`);
    }
  }
}
