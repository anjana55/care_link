import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID as uuid } from 'crypto';
import { and, asc, count, desc, eq, inArray, ne, sql } from 'drizzle-orm';
import {
  EMERGENCY_NUMBERS,
  type CountryCode,
  type StaffWelfareReport,
  type WelfareMessage,
  type WelfareReport,
  type WelfareSeverity,
  type WelfareStatus,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { caregivers, employerEnquiries, placements, users, welfareReportMessages, welfareReports } from '../database/schema';
import { WelfareMessageDto, WelfareQueryDto, WelfareReportDto } from './dto/phase4.dto';
import { InternationalNotifier } from './international-notifier.service';
import { iso } from './employer-enquiries.service';
import { shortReference, withUniqueRetry } from './codes';

type ReportRow = typeof welfareReports.$inferSelect;
type MessageRow = typeof welfareReportMessages.$inferSelect;

/** Most serious first; within that, oldest first - the one waiting longest. */
const SEVERITY_ORDER = sql`FIELD(${welfareReports.severity}, 'SOS', 'URGENT', 'CONCERN', 'QUESTION')`;
const EMERGENCY: WelfareSeverity[] = ['SOS', 'URGENT'];

/** How many reports a caregiver can open in a day: plenty for a real problem, a stop on a stuck button. */
export const MAX_REPORTS_PER_DAY = 10;

/** What a caregiver must write, by severity: an SOS can be the button alone. */
export function checkReport(dto: WelfareReportDto): string {
  const message = (dto.message ?? '').trim();
  if (dto.severity !== 'SOS' && message.length < 5) throw new BadRequestException('Tell us what is happening, in a sentence or two.');
  return message || 'SOS - the caregiver pressed the emergency button.';
}

function toMessage(m: MessageRow): WelfareMessage {
  return { id: m.id, from: m.authorRole, body: m.body, createdAt: iso(m.createdAt) };
}

/**
 * A caregiver abroad telling us something is wrong, or asking a question,
 * and the conversation with staff that follows. SOS and urgent reports go
 * to every staff member at once, with how to reach the caregiver. The
 * employer never sees any of it.
 */
@Injectable()
export class WelfareService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly notifier: InternationalNotifier,
  ) {}

  // --- the caregiver -----------------------------------------------------------------

  async forCaregiver(caregiverId: string): Promise<WelfareReport[]> {
    const rows = await this.db.select().from(welfareReports).where(eq(welfareReports.caregiverId, caregiverId)).orderBy(desc(welfareReports.updatedAt)).limit(50);
    return this.withMessages(rows);
  }

  async create(caregiverId: string, placementId: string, dto: WelfareReportDto, userId: string): Promise<WelfareReport[]> {
    const [p] = await this.db.select().from(placements).where(eq(placements.id, placementId)).limit(1);
    if (!p || p.caregiverId !== caregiverId) throw new NotFoundException('Placement not found');
    if (p.status !== 'PRE_DEPARTURE' && p.status !== 'DEPLOYED') throw new BadRequestException('This placement has ended. Call our office if you need help.');
    const body = checkReport(dto);
    const [{ n }] = await this.db
      .select({ n: count() })
      .from(welfareReports)
      .where(and(eq(welfareReports.caregiverId, caregiverId), sql`${welfareReports.createdAt} >= NOW() - INTERVAL 1 DAY`));
    // Never stop an SOS: a limit is for the everyday kind.
    if (dto.severity !== 'SOS' && Number(n) >= MAX_REPORTS_PER_DAY) throw new BadRequestException('You have sent several reports today. Add to one of them instead, or call our office.');
    const id = uuid();
    await withUniqueRetry(() =>
      this.db.insert(welfareReports).values({ id, reference: shortReference('WR'), placementId, caregiverId, severity: dto.severity, category: dto.category }),
    );
    await this.db.insert(welfareReportMessages).values({ id: uuid(), reportId: id, authorRole: 'CAREGIVER', authorUserId: userId, body });
    void this.alertStaff(id, 'new');
    return this.forCaregiver(caregiverId);
  }

  async caregiverMessage(caregiverId: string, reportId: string, dto: WelfareMessageDto, userId: string): Promise<WelfareReport[]> {
    const report = await this.row(reportId);
    if (report.caregiverId !== caregiverId) throw new NotFoundException('Report not found');
    await this.db.insert(welfareReportMessages).values({ id: uuid(), reportId, authorRole: 'CAREGIVER', authorUserId: userId, body: dto.body });
    // Writing again on a closed report opens it again.
    await this.db
      .update(welfareReports)
      .set({ ...(report.status === 'RESOLVED' ? { status: 'OPEN' as const, resolvedAt: null, resolvedByUserId: null } : {}), updatedAt: new Date() })
      .where(eq(welfareReports.id, reportId));
    void this.alertStaff(reportId, 'reply');
    return this.forCaregiver(caregiverId);
  }

  // --- staff ---------------------------------------------------------------------------

  async staffList(query: WelfareQueryDto): Promise<StaffWelfareReport[]> {
    const status = query.status ?? 'open';
    const where = status === 'open' ? ne(welfareReports.status, 'RESOLVED') : status === 'all' ? undefined : eq(welfareReports.status, status);
    const rows = await this.staffSelect().where(where).orderBy(SEVERITY_ORDER, asc(welfareReports.createdAt)).limit(300);
    return this.toStaff(rows);
  }

  async staffGet(id: string): Promise<StaffWelfareReport> {
    const rows = await this.staffSelect().where(eq(welfareReports.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException('Report not found');
    return (await this.toStaff(rows))[0];
  }

  /** A staff reply. The first reply acknowledges the report. */
  async staffMessage(id: string, dto: WelfareMessageDto, userId: string): Promise<StaffWelfareReport> {
    const report = await this.row(id);
    await this.db.insert(welfareReportMessages).values({ id: uuid(), reportId: id, authorRole: 'STAFF', authorUserId: userId, body: dto.body });
    await this.db
      .update(welfareReports)
      .set({
        ...(report.status === 'OPEN' ? { status: 'ACKNOWLEDGED' as const, acknowledgedAt: new Date(), acknowledgedByUserId: userId } : {}),
        updatedAt: new Date(),
      })
      .where(eq(welfareReports.id, id));
    void this.notifyCaregiverOfReply(report);
    return this.staffGet(id);
  }

  async setStatus(id: string, status: WelfareStatus, userId: string): Promise<StaffWelfareReport> {
    const report = await this.row(id);
    const now = new Date();
    const changes: Partial<ReportRow> = { status, updatedAt: now };
    if (status === 'ACKNOWLEDGED' && !report.acknowledgedAt) Object.assign(changes, { acknowledgedAt: now, acknowledgedByUserId: userId });
    if (status === 'RESOLVED') Object.assign(changes, { resolvedAt: now, resolvedByUserId: userId, ...(report.acknowledgedAt ? {} : { acknowledgedAt: now, acknowledgedByUserId: userId }) });
    if (status !== 'RESOLVED') Object.assign(changes, { resolvedAt: null, resolvedByUserId: null });
    await this.db.update(welfareReports).set(changes).where(eq(welfareReports.id, id));
    return this.staffGet(id);
  }

  async openCounts(): Promise<{ open: number; urgent: number }> {
    const rows = await this.db
      .select({ severity: welfareReports.severity, n: count() })
      .from(welfareReports)
      .where(eq(welfareReports.status, 'OPEN'))
      .groupBy(welfareReports.severity);
    const open = rows.reduce((s, r) => s + Number(r.n), 0);
    const urgent = rows.filter((r) => EMERGENCY.includes(r.severity)).reduce((s, r) => s + Number(r.n), 0);
    return { open, urgent };
  }

  /** Reports not resolved, per placement. */
  async unresolvedByPlacement(placementIds: string[]): Promise<Map<string, number>> {
    if (!placementIds.length) return new Map();
    const rows = await this.db
      .select({ placementId: welfareReports.placementId, n: count() })
      .from(welfareReports)
      .where(and(inArray(welfareReports.placementId, placementIds), ne(welfareReports.status, 'RESOLVED')))
      .groupBy(welfareReports.placementId);
    return new Map(rows.map((r) => [r.placementId, Number(r.n)]));
  }

  // --- internals ------------------------------------------------------------------------------

  private async withMessages(rows: ReportRow[]): Promise<WelfareReport[]> {
    if (!rows.length) return [];
    const messages = await this.db
      .select()
      .from(welfareReportMessages)
      .where(inArray(welfareReportMessages.reportId, rows.map((r) => r.id)))
      .orderBy(asc(welfareReportMessages.createdAt));
    return rows.map((r) => ({
      id: r.id,
      reference: r.reference,
      placementId: r.placementId,
      severity: r.severity,
      category: r.category,
      status: r.status,
      messages: messages.filter((m) => m.reportId === r.id).map(toMessage),
      createdAt: iso(r.createdAt),
      updatedAt: iso(r.updatedAt),
    }));
  }

  private staffSelect() {
    return this.db
      .select({ r: welfareReports, p: placements, c: caregivers, organisationName: employerEnquiries.organisationName })
      .from(welfareReports)
      .innerJoin(placements, eq(welfareReports.placementId, placements.id))
      .innerJoin(caregivers, eq(welfareReports.caregiverId, caregivers.id))
      .innerJoin(employerEnquiries, eq(placements.enquiryId, employerEnquiries.id))
      .$dynamic();
  }

  private async toStaff(
    rows: { r: ReportRow; p: typeof placements.$inferSelect; c: typeof caregivers.$inferSelect; organisationName: string }[],
  ): Promise<StaffWelfareReport[]> {
    const withMessages = await this.withMessages(rows.map((x) => x.r));
    return rows.map(({ r, p, c, organisationName }, i) => ({
      ...withMessages[i],
      caregiverId: c.id,
      fullName: c.fullName,
      registrationNumber: c.registrationNumber,
      country: p.country,
      organisationName,
      contact: {
        addressAbroad: p.addressAbroad,
        phoneAbroad: p.phoneAbroad,
        emergencyContactName: c.emergencyContactName ?? null,
        emergencyContactNumber: c.emergencyContactNumber ?? null,
        emergencyContactRelationship: c.emergencyContactRelationship ?? null,
      },
      acknowledgedAt: r.acknowledgedAt ? iso(r.acknowledgedAt) : null,
      resolvedAt: r.resolvedAt ? iso(r.resolvedAt) : null,
    }));
  }

  private async row(id: string): Promise<ReportRow> {
    const [row] = await this.db.select().from(welfareReports).where(eq(welfareReports.id, id)).limit(1);
    if (!row) throw new NotFoundException('Report not found');
    return row;
  }

  /**
   * SOS and urgent: every staff member, with how to reach the caregiver
   * right now. Anything else: the usual alert list.
   */
  private async alertStaff(reportId: string, what: 'new' | 'reply') {
    const r = await this.staffGet(reportId).catch(() => null);
    if (!r) return;
    const last = r.messages[r.messages.length - 1]?.body ?? '';
    const emergency = EMERGENCY.includes(r.severity) && r.status !== 'RESOLVED';
    const local = EMERGENCY_NUMBERS[r.country as CountryCode];
    const notice = {
      subject: `${emergency ? `${r.severity}: ` : ''}${what === 'new' ? 'Welfare report' : 'New message on welfare report'} ${r.reference} - ${r.fullName} (${r.country})`,
      paragraphs: [
        `${r.fullName} (${r.registrationNumber}), placed with ${r.organisationName} in ${r.country}, ${what === 'new' ? `reported: ${r.category.toLowerCase()}` : 'wrote again'}.`,
        `"${last}"`,
        `Phone abroad: ${r.contact.phoneAbroad ?? 'not given'}. Address abroad: ${r.contact.addressAbroad ?? 'not given'}.`,
        `Emergency contact at home: ${r.contact.emergencyContactName ?? '-'} (${r.contact.emergencyContactRelationship ?? '-'}) ${r.contact.emergencyContactNumber ?? ''}.`,
        ...(emergency && local ? [`Local emergency numbers there: police ${local.police}, ambulance ${local.ambulance}.`] : []),
        emergency ? 'Reply in the staff portal and call the caregiver now.' : 'Reply in the staff portal.',
      ],
      cta: { label: 'Open report', url: this.notifier.staffUrl(`/international?tab=welfare&report=${r.id}`) },
    };
    if (emergency) await this.notifier.toAllStaff(`welfare ${r.severity} ${r.reference}`, notice);
    else await this.notifier.toStaff(`welfare ${r.reference}`, notice);
  }

  private async notifyCaregiverOfReply(report: ReportRow) {
    const [cg] = await this.db
      .select({ email: users.email })
      .from(caregivers)
      .innerJoin(users, eq(caregivers.userId, users.id))
      .where(eq(caregivers.id, report.caregiverId))
      .limit(1);
    await this.notifier.toAddress(cg?.email, `welfare reply ${report.reference}`, {
      subject: `Our team replied - ${report.reference}`,
      paragraphs: ['Our team has replied to your report. Read it in Work abroad.'],
      cta: { label: 'Open Work abroad', url: this.notifier.publicUrl('/caregiver/work-abroad') },
    });
  }
}
