import { BadRequestException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { TALK_MAX_OPEN, type MyTalkRequest, type StaffTalkRequest, type TalkAboutType } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { bookingShifts, bookings, careRequests, caregivers, patients, talkRequests, users } from '../database/schema';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AutomationService } from '../automation/automation.service';
import { EmailService } from '../email/email.service';
import { EmailSettingsService } from '../email/email-settings.service';
import type { TalkRequestDto } from './dto/talk.dto';

type CaseRef = { caseType: 'REQUEST' | 'BOOKING'; caseId: string };

/**
 * "Talk to a person". A client or caregiver can always reach a member of
 * staff, however much the agents do:
 *
 * - They say what they need and how to reach them, and may name one of their
 *   requests, bookings or shifts.
 * - A named case is taken over at once (source PERSON): the agents stop on it
 *   until staff hand it back. Nothing else changes.
 * - Staff are emailed that someone is waiting - without the message, which
 *   can carry health details - and see it under People waiting and in the
 *   dashboard's Needs attention. They mark it handled, with a note.
 */
@Injectable()
export class TalkService {
  private readonly logger = new Logger(TalkService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly config: ConfigService,
    private readonly automation: AutomationService,
    private readonly email: EmailService,
    private readonly emailSettings: EmailSettingsService,
  ) {}

  private role(user: AuthenticatedUser): 'CLIENT' | 'CAREGIVER' {
    if (user.role === 'CAREGIVER' && user.caregiverId) return 'CAREGIVER';
    if (user.patientId) return 'CLIENT';
    throw new BadRequestException('Only clients and caregivers can ask here');
  }

  /** The case the person named, if it is theirs; someone else's answers as one that does not exist. */
  private async caseFor(user: AuthenticatedUser, type: TalkAboutType, id: string): Promise<{ ref: CaseRef; reference: string }> {
    const missing = () => new NotFoundException('We could not find that - choose another, or leave it blank');
    if (type === 'REQUEST') {
      if (!user.patientId) throw missing();
      const [r] = await this.db.select({ id: careRequests.id, reference: careRequests.reference }).from(careRequests).where(and(eq(careRequests.id, id), eq(careRequests.patientId, user.patientId))).limit(1);
      if (!r) throw missing();
      return { ref: { caseType: 'REQUEST', caseId: r.id }, reference: r.reference };
    }
    if (type === 'BOOKING') {
      const [b] = await this.db.select({ id: bookings.id, reference: bookings.reference, patientId: bookings.patientId, caregiverId: bookings.caregiverId }).from(bookings).where(eq(bookings.id, id)).limit(1);
      if (!b) throw missing();
      if (user.patientId ? b.patientId !== user.patientId : !(await this.worksOn(user.caregiverId, b.id, b.caregiverId))) throw missing();
      return { ref: { caseType: 'BOOKING', caseId: b.id }, reference: b.reference };
    }
    const [s] = await this.db
      .select({ bookingId: bookings.id, reference: bookings.reference, patientId: bookings.patientId, caregiverId: bookingShifts.caregiverId })
      .from(bookingShifts)
      .innerJoin(bookings, eq(bookings.id, bookingShifts.bookingId))
      .where(eq(bookingShifts.id, id))
      .limit(1);
    if (!s) throw missing();
    if (user.patientId ? s.patientId !== user.patientId : s.caregiverId !== user.caregiverId) throw missing();
    return { ref: { caseType: 'BOOKING', caseId: s.bookingId }, reference: s.reference };
  }

  private async worksOn(caregiverId: string | undefined, bookingId: string, booked: string): Promise<boolean> {
    if (!caregiverId) return false;
    if (booked === caregiverId) return true;
    const [one] = await this.db.select({ id: bookingShifts.id }).from(bookingShifts).where(and(eq(bookingShifts.bookingId, bookingId), eq(bookingShifts.caregiverId, caregiverId))).limit(1);
    return Boolean(one);
  }

  async ask(user: AuthenticatedUser, dto: TalkRequestDto): Promise<MyTalkRequest> {
    const role = this.role(user);
    const [open] = await this.db.select({ n: count() }).from(talkRequests).where(and(eq(talkRequests.userId, user.userId), eq(talkRequests.status, 'OPEN')));
    if ((open?.n ?? 0) >= TALK_MAX_OPEN) throw new BadRequestException('We already have your messages - someone will contact you soon');
    const about = dto.about ? await this.caseFor(user, dto.about.type, dto.about.id) : null;
    const id = uuid();
    await this.db.insert(talkRequests).values({ id, userId: user.userId, role, aboutType: dto.about?.type ?? null, aboutId: dto.about?.id ?? null, message: dto.message, contact: dto.contact });
    if (about) {
      // The agents step back from this case until staff hand it back.
      await this.automation
        .takeOver(about.ref, { userId: user.userId, source: 'PERSON', reason: `${role === 'CLIENT' ? 'The client' : 'The caregiver'} asked to talk to a person` })
        .catch((e) => this.logger.warn(`Talk to a person: could not take over ${about.ref.caseType} ${about.ref.caseId} - ${(e as Error).message}`));
    }
    await this.tellStaff(role, about?.reference ?? null, dto.contact);
    const [row] = await this.db.select().from(talkRequests).where(eq(talkRequests.id, id)).limit(1);
    return this.mine(row);
  }

  async listMine(user: AuthenticatedUser): Promise<MyTalkRequest[]> {
    const rows = await this.db.select().from(talkRequests).where(eq(talkRequests.userId, user.userId)).orderBy(desc(talkRequests.createdAt)).limit(10);
    return rows.map((r) => this.mine(r));
  }

  private mine(r: typeof talkRequests.$inferSelect): MyTalkRequest {
    return { id: r.id, createdAt: r.createdAt.toISOString(), message: r.message, contact: r.contact, status: r.status, handledAt: r.handledAt?.toISOString() ?? null };
  }

  /** Staff: open first (oldest first - longest waiting), then the latest handled. */
  async list(status: 'OPEN' | 'HANDLED' | 'ALL' = 'OPEN'): Promise<StaffTalkRequest[]> {
    const rows = await this.db
      .select()
      .from(talkRequests)
      .where(status === 'ALL' ? undefined : eq(talkRequests.status, status))
      .orderBy(status === 'OPEN' ? talkRequests.createdAt : desc(talkRequests.createdAt))
      .limit(200);
    if (!rows.length) return [];
    const userIds = [...new Set(rows.flatMap((r) => [r.userId, r.handledByUserId].filter((x): x is string => Boolean(x))))];
    const [people, clients, carers, reqs, books, shifts] = await Promise.all([
      this.db.select({ id: users.id, email: users.email, name: users.fullName }).from(users).where(inArray(users.id, userIds)),
      this.db.select({ id: patients.id, userId: patients.userId, name: patients.fullName, phone: patients.phone }).from(patients).where(inArray(patients.userId, userIds)),
      this.db.select({ id: caregivers.id, userId: caregivers.userId, name: caregivers.fullName, phone: caregivers.primaryPhone }).from(caregivers).where(inArray(caregivers.userId, userIds)),
      this.idsOf(rows, 'REQUEST').length ? this.db.select({ id: careRequests.id, reference: careRequests.reference }).from(careRequests).where(inArray(careRequests.id, this.idsOf(rows, 'REQUEST'))) : Promise.resolve([] as { id: string; reference: string }[]),
      this.idsOf(rows, 'BOOKING').length ? this.db.select({ id: bookings.id, reference: bookings.reference }).from(bookings).where(inArray(bookings.id, this.idsOf(rows, 'BOOKING'))) : Promise.resolve([] as { id: string; reference: string }[]),
      this.idsOf(rows, 'SHIFT').length
        ? this.db.select({ id: bookingShifts.id, bookingId: bookings.id, reference: bookings.reference }).from(bookingShifts).innerJoin(bookings, eq(bookings.id, bookingShifts.bookingId)).where(inArray(bookingShifts.id, this.idsOf(rows, 'SHIFT')))
        : Promise.resolve([] as { id: string; bookingId: string; reference: string }[]),
    ]);
    return rows.map((r) => {
      const account = people.find((p) => p.id === r.userId);
      const client = clients.find((c) => c.userId === r.userId);
      const carer = carers.find((c) => c.userId === r.userId);
      let about: StaffTalkRequest['about'] = null;
      if (r.aboutType === 'REQUEST') {
        const x = reqs.find((q) => q.id === r.aboutId);
        if (x) about = { type: 'REQUEST', id: x.id, reference: x.reference, bookingId: null, requestId: x.id };
      } else if (r.aboutType === 'BOOKING') {
        const x = books.find((b) => b.id === r.aboutId);
        if (x) about = { type: 'BOOKING', id: x.id, reference: x.reference, bookingId: x.id, requestId: null };
      } else if (r.aboutType === 'SHIFT') {
        const x = shifts.find((s) => s.id === r.aboutId);
        if (x) about = { type: 'SHIFT', id: x.id, reference: x.reference, bookingId: x.bookingId, requestId: null };
      }
      return {
        ...this.mine(r),
        role: r.role,
        person: {
          name: client?.name ?? carer?.name ?? account?.name ?? '-',
          phone: client?.phone ?? carer?.phone ?? null,
          email: account?.email ?? null,
          patientId: client?.id ?? null,
          caregiverId: carer?.id ?? null,
        },
        about,
        handledByName: r.handledByUserId ? (people.find((p) => p.id === r.handledByUserId)?.name ?? null) : null,
        staffNote: r.staffNote,
      };
    });
  }

  private idsOf(rows: (typeof talkRequests.$inferSelect)[], type: TalkAboutType): string[] {
    return [...new Set(rows.filter((r) => r.aboutType === type && r.aboutId).map((r) => r.aboutId!))];
  }

  async handle(id: string, note: string | undefined, staff: AuthenticatedUser): Promise<StaffTalkRequest> {
    const [r] = await this.db.select().from(talkRequests).where(eq(talkRequests.id, id)).limit(1);
    if (!r) throw new NotFoundException('This message was not found');
    if (r.status !== 'HANDLED') {
      await this.db.update(talkRequests).set({ status: 'HANDLED', handledAt: new Date(), handledByUserId: staff.userId, staffNote: note?.trim() || null }).where(eq(talkRequests.id, id));
    }
    return (await this.list('ALL')).find((x) => x.id === id)!;
  }

  async openCount(): Promise<number> {
    const [row] = await this.db.select({ n: count() }).from(talkRequests).where(eq(talkRequests.status, 'OPEN'));
    return Number(row?.n ?? 0);
  }

  private async tellStaff(role: 'CLIENT' | 'CAREGIVER', reference: string | null, contact: string) {
    const settings = await this.emailSettings.getResolved();
    const to = settings.requestAlertsTo
      ? settings.requestAlertsTo.split(',').map((a) => a.trim()).filter(Boolean)
      : (await this.db.select({ email: users.email }).from(users).where(and(inArray(users.role, ['ADMIN', 'STAFF']), eq(users.isActive, true)))).map((u) => u.email).filter((e): e is string => Boolean(e));
    if (!to.length) return;
    const who = role === 'CLIENT' ? 'A client' : 'A caregiver';
    const how = contact === 'CALL' ? 'a phone call' : contact === 'WHATSAPP' ? 'WhatsApp' : 'email';
    try {
      await this.email.sendNotificationEmail(
        to,
        {
          subject: `${who} asked to talk to a person`,
          blocks: [
            {
              lang: 'en',
              heading: `${who} asked to talk to a person`,
              paragraphs: [
                `${who} would like to hear from someone${reference ? ` about ${reference}` : ''}, by ${how}.`,
                ...(reference ? ['The agents have stepped back from that case until you hand it back.'] : []),
                'Open People waiting to read what they wrote and to reach them.',
              ],
            },
          ],
          cta: { label: 'Open People waiting', url: `${(this.config.get<string>('CAREGIVER_WEB_URL') ?? 'http://localhost:3000/staff').replace(/\/+$/, '')}/people-waiting` },
        },
        'talk to a person',
      );
    } catch (err) {
      this.logger.warn(`Talk to a person: staff email failed - ${(err as Error).message}`);
    }
  }
}
