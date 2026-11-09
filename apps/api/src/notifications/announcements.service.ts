import { BadRequestException, ConflictException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { randomUUID as uuid } from 'crypto';
import { and, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { inQuietHours, toColombo, type Announcement, type AnnouncementAudience, type NotificationText } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { announcements, deviceTokens, notifications, users } from '../database/schema';
import { WhatsappSettingsService } from '../whatsapp/whatsapp-settings.service';
import { WhatsappProviderService } from '../whatsapp/whatsapp-provider.service';
import { NotificationsService } from './notifications.service';
import { NotificationSettingsService } from './notification-settings.service';
import type { SaveAnnouncementDto } from './dto/notifications.dto';

const ROLES: Record<AnnouncementAudience, ('PATIENT_GUARDIAN' | 'CAREGIVER')[]> = {
  CLIENTS: ['PATIENT_GUARDIAN'],
  CAREGIVERS: ['CAREGIVER'],
  ALL: ['PATIENT_GUARDIAN', 'CAREGIVER'],
};

/** Sinhala and Tamil left empty take the English, so nobody gets a blank notice. */
export function announcementText(dto: Pick<SaveAnnouncementDto, 'en' | 'si' | 'ta'>): NotificationText {
  const pick = (t: { title?: string; body?: string } | undefined) => ({ title: t?.title?.trim() || dto.en.title, body: t?.body?.trim() || dto.en.body });
  return { en: { title: dto.en.title, body: dto.en.body }, si: pick(dto.si), ta: pick(dto.ta) };
}

/**
 * Staff messages to every client, every caregiver, or both: office holiday
 * hours, a rate change, a safety notice. Written as a draft, then published
 * into each person's notifications (and pushed, and - if ticked - sent by
 * WhatsApp, which costs per message). Unpublishing takes it out of everyone's
 * notifications again.
 */
@Injectable()
export class AnnouncementsService {
  private readonly logger = new Logger(AnnouncementsService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly notices: NotificationsService,
    private readonly settings: NotificationSettingsService,
    private readonly whatsappSettings: WhatsappSettingsService,
    private readonly whatsapp: WhatsappProviderService,
  ) {}

  async list(): Promise<Announcement[]> {
    const rows = await this.db
      .select({ a: announcements, createdByName: users.fullName })
      .from(announcements)
      .leftJoin(users, eq(users.id, announcements.createdByUserId))
      .orderBy(desc(announcements.createdAt))
      .limit(100);
    const reads = await this.notices.readCountsFor(rows.filter((r) => r.a.publishedAt).map((r) => r.a.id));
    return rows.map((r) => this.view(r.a, r.createdByName, reads.get(r.a.id) ?? 0));
  }

  async get(id: string): Promise<Announcement> {
    const [r] = await this.db
      .select({ a: announcements, createdByName: users.fullName })
      .from(announcements)
      .leftJoin(users, eq(users.id, announcements.createdByUserId))
      .where(eq(announcements.id, id))
      .limit(1);
    if (!r) throw new NotFoundException('Announcement not found');
    const reads = r.a.publishedAt ? await this.notices.readCountsFor([id]) : new Map<string, number>();
    return this.view(r.a, r.createdByName, reads.get(id) ?? 0);
  }

  private view(a: typeof announcements.$inferSelect, createdByName: string | null, readCount: number): Announcement {
    return {
      id: a.id,
      audience: a.audience,
      text: a.text,
      link: a.link,
      important: a.important,
      sendPush: a.sendPush,
      sendWhatsapp: a.sendWhatsapp,
      createdByName,
      createdAt: a.createdAt.toISOString(),
      publishedAt: a.publishedAt ? a.publishedAt.toISOString() : null,
      recipients: a.recipients,
      readCount,
    };
  }

  async create(dto: SaveAnnouncementDto, userId: string): Promise<Announcement> {
    const id = uuid();
    await this.db.insert(announcements).values({
      id,
      audience: dto.audience,
      text: announcementText(dto),
      link: dto.link ?? null,
      important: Boolean(dto.important),
      sendPush: dto.sendPush ?? true,
      sendWhatsapp: Boolean(dto.sendWhatsapp),
      createdByUserId: userId,
    });
    return this.get(id);
  }

  async update(id: string, dto: SaveAnnouncementDto): Promise<Announcement> {
    const current = await this.get(id);
    if (current.publishedAt) throw new ConflictException('It has been published: unpublish it to change it');
    await this.db
      .update(announcements)
      .set({
        audience: dto.audience,
        text: announcementText(dto),
        link: dto.link ?? null,
        important: Boolean(dto.important),
        sendPush: dto.sendPush ?? true,
        sendWhatsapp: Boolean(dto.sendWhatsapp),
        updatedAt: new Date(),
      })
      .where(eq(announcements.id, id));
    return this.get(id);
  }

  /** Who it goes to: active accounts of that kind. */
  async audienceUserIds(audience: AnnouncementAudience): Promise<string[]> {
    const rows = await this.db
      .select({ id: users.id })
      .from(users)
      .where(and(inArray(users.role, ROLES[audience]), eq(users.isActive, true)));
    return rows.map((r) => r.id);
  }

  async publish(id: string, now = new Date()): Promise<Announcement> {
    const a = await this.get(id);
    if (a.publishedAt) throw new ConflictException('It has already been published');
    const s = await this.settings.getResolved();
    if ((a.sendPush || a.sendWhatsapp) && inQuietHours(Number(toColombo(now).time.slice(0, 2)), s)) {
      const hours = `${String(s.quietStartHour).padStart(2, '0')}:00–${String(s.quietEndHour).padStart(2, '0')}:00`;
      throw new BadRequestException(`It's quiet hours (${hours}), when nobody is sent a push or WhatsApp. Publish it to the bell only (untick both), or publish it later.`);
    }
    // Claim it first, so two clicks can't publish it twice.
    const [claimed] = await this.db
      .update(announcements)
      .set({ publishedAt: now, updatedAt: now })
      .where(and(eq(announcements.id, id), isNull(announcements.publishedAt)));
    if (!Number((claimed as { affectedRows?: number })?.affectedRows ?? 0)) throw new ConflictException('It has already been published');

    const userIds = await this.audienceUserIds(a.audience);
    const build = (lang: 'en' | 'si' | 'ta') => a.text[lang] ?? a.text.en;
    const written = await this.notices.deliver(userIds, build, '/notifications', `announcement ${id}`, {
      category: 'ANNOUNCEMENT',
      important: a.important,
      link: a.link,
      announcementId: id,
      push: a.sendPush,
    });
    await this.db.update(announcements).set({ recipients: written.size }).where(eq(announcements.id, id));
    if (a.sendWhatsapp) void this.whatsappAll(userIds, a.text, id);
    return this.get(id);
  }

  /** One WhatsApp update each, in the language their app is set to (English otherwise). Never throws. */
  private async whatsappAll(userIds: string[], text: NotificationText, id: string) {
    try {
      const wa = await this.whatsappSettings.getResolved();
      if (!this.whatsapp.canSendUpdates(wa)) {
        this.logger.warn(`Announcement ${id}: WhatsApp updates are off, so no WhatsApp messages were sent.`);
        return;
      }
      let sent = 0;
      for (let i = 0; i < userIds.length; i += 500) {
        const batch = userIds.slice(i, i + 500);
        const people = await this.db.select({ id: users.id, phone: users.phone }).from(users).where(and(inArray(users.id, batch), isNotNull(users.phone)));
        const locales = await this.db
          .select({ userId: deviceTokens.userId, locale: deviceTokens.locale })
          .from(deviceTokens)
          .where(and(inArray(deviceTokens.userId, batch), isNull(deviceTokens.revokedAt)));
        const localeOf = new Map(locales.map((l) => [l.userId, l.locale]));
        for (const p of people) {
          const lang = localeOf.get(p.id) ?? 'en';
          const t = text[lang] ?? text.en;
          try {
            await this.whatsapp.sendUpdate(wa, p.phone!, lang, `${t.title}. ${t.body}`);
            sent++;
          } catch (err) {
            this.logger.warn(`Announcement ${id}: WhatsApp to one person failed: ${(err as Error).message}`);
          }
        }
      }
      this.logger.log(`Announcement ${id}: ${sent} WhatsApp message(s) sent.`);
    } catch (err) {
      this.logger.error(`Announcement ${id}: WhatsApp sending stopped: ${(err as Error).message}`);
    }
  }

  /** A draft is deleted; a published one is taken out of everyone's notifications and deleted. */
  async remove(id: string): Promise<void> {
    await this.get(id);
    await this.db.delete(notifications).where(eq(notifications.announcementId, id));
    await this.db.delete(announcements).where(eq(announcements.id, id));
  }
}
