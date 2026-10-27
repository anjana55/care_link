import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID as uuid } from 'crypto';
import { and, asc, desc, eq, gte, inArray, lt } from 'drizzle-orm';
import type { CandidateStatus, CaregiverInterview, EmployerInterview, InterviewStatus, StaffInterview } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { candidateInterviews, caregivers, employerEnquiries, enquiryCandidates, users } from '../database/schema';
import { InterviewDto, InterviewQueryDto, UpdateInterviewDto } from './dto/phase4.dto';
import { InternationalNotifier } from './international-notifier.service';
import { SharedProfilesService } from './shared-profiles.service';
import { iso } from './employer-enquiries.service';

type InterviewRow = typeof candidateInterviews.$inferSelect;

/** Candidates in these states can't be interviewed any more. */
const CLOSED: CandidateStatus[] = ['PLACED', 'NOT_PROCEEDING'];

/** "Wed, 4 Nov 2026, 10:00 Sri Lanka time (04:30 UTC)": for emails, where we can't know the reader's zone. */
export function describeWhen(at: Date): string {
  const colombo = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Colombo',
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(at);
  const utc = new Intl.DateTimeFormat('en-GB', { timeZone: 'UTC', hour: '2-digit', minute: '2-digit', hour12: false }).format(at);
  return `${colombo} Sri Lanka time (${utc} UTC)`;
}

/** An interview may be booked from a few minutes ago (typing it in) up to a year ahead. */
export function checkWhen(at: Date, now = Date.now()): void {
  if (Number.isNaN(at.getTime())) throw new BadRequestException('Give a valid interview date and time.');
  if (at.getTime() < now - 5 * 60_000) throw new BadRequestException('The interview time is in the past.');
  if (at.getTime() > now + 366 * 86_400_000) throw new BadRequestException('The interview is more than a year away.');
}

/** The candidate's status and next interview, once interviews change. */
export function candidateAfterInterviews(current: CandidateStatus, interviews: Pick<InterviewRow, 'status' | 'scheduledAt'>[], now = Date.now()): { status: CandidateStatus; interviewAt: Date | null } {
  const upcoming = interviews
    .filter((i) => i.status === 'SCHEDULED')
    .map((i) => new Date(i.scheduledAt))
    .sort((a, b) => a.getTime() - b.getTime());
  const next = upcoming.find((d) => d.getTime() >= now - 2 * 3600_000) ?? upcoming[upcoming.length - 1] ?? null;
  if (current === 'SELECTED' || CLOSED.includes(current)) return { status: current, interviewAt: next };
  if (upcoming.length) return { status: 'INTERVIEW_SCHEDULED', interviewAt: next };
  // Every interview called off: back with the employer's request, so staff see it waiting.
  if (current === 'INTERVIEW_SCHEDULED') {
    const held = interviews.some((i) => i.status === 'COMPLETED');
    return { status: held ? 'INTERVIEW_SCHEDULED' : 'INTERVIEW_REQUESTED', interviewAt: null };
  }
  return { status: current, interviewAt: null };
}

function toInterview(r: InterviewRow) {
  return {
    id: r.id,
    candidateId: r.candidateId,
    round: r.round,
    scheduledAt: iso(r.scheduledAt),
    durationMinutes: r.durationMinutes,
    mode: r.mode,
    meetingLink: r.meetingLink,
    location: r.location,
    instructions: r.instructions,
    status: r.status as InterviewStatus,
    cancelReason: r.cancelReason,
  };
}

/**
 * Interviews staff arrange between an employer and a candidate: when, how,
 * and a link or place. Both sides see the time in their own zone and can
 * add it to their calendar. The employer records feedback afterwards; the
 * caregiver never sees it.
 */
@Injectable()
export class InterviewsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly notifier: InternationalNotifier,
    private readonly sharedProfiles: SharedProfilesService,
  ) {}

  // --- staff ---------------------------------------------------------------------

  async schedule(candidateId: string, dto: InterviewDto, userId: string): Promise<StaffInterview> {
    const { c, e } = await this.candidateWithEnquiry(candidateId);
    if (CLOSED.includes(c.status)) throw new BadRequestException('This candidate is no longer in the running.');
    if (!(await this.sharedProfiles.liveSlugs([c.caregiverId])).has(c.caregiverId)) {
      throw new BadRequestException('This caregiver has stopped sharing their profile, so an interview cannot be arranged.');
    }
    checkMode(dto);
    const at = new Date(dto.scheduledAt);
    checkWhen(at);
    const existing = await this.db.select().from(candidateInterviews).where(eq(candidateInterviews.candidateId, candidateId));
    const id = uuid();
    const row = {
      id,
      candidateId,
      round: existing.length + 1,
      scheduledAt: at,
      durationMinutes: dto.durationMinutes,
      mode: dto.mode,
      meetingLink: dto.meetingLink ?? null,
      location: dto.location ?? null,
      instructions: dto.instructions ?? null,
      createdByUserId: userId,
    };
    await this.db.insert(candidateInterviews).values(row);
    await this.syncCandidate(c, [...existing, { ...row, status: 'SCHEDULED' } as InterviewRow]);
    void this.notifyBoth(c.caregiverId, e, 'scheduled', { ...row, status: 'SCHEDULED' } as InterviewRow);
    return this.staffGet(id);
  }

  async update(id: string, dto: UpdateInterviewDto): Promise<StaffInterview> {
    const current = await this.row(id);
    const { c, e } = await this.candidateWithEnquiry(current.candidateId);
    const changes: Partial<InterviewRow> = { updatedAt: new Date() };
    if (dto.scheduledAt !== undefined) {
      const at = new Date(dto.scheduledAt);
      if (at.getTime() !== new Date(current.scheduledAt).getTime()) checkWhen(at);
      changes.scheduledAt = at;
    }
    for (const key of ['durationMinutes', 'mode', 'meetingLink', 'location', 'instructions', 'status', 'cancelReason'] as const) {
      if (dto[key] !== undefined) (changes as Record<string, unknown>)[key] = dto[key];
    }
    const next = { ...current, ...changes } as InterviewRow;
    if (next.status === 'CANCELLED' && !next.cancelReason) throw new BadRequestException('Say why the interview is cancelled.');
    if (next.status !== 'CANCELLED') next.cancelReason = changes.cancelReason = null;
    if (next.status === 'SCHEDULED' || dto.mode !== undefined || dto.meetingLink !== undefined || dto.location !== undefined) checkMode(next);
    if ((next.status === 'COMPLETED' || next.status === 'NO_SHOW') && new Date(next.scheduledAt).getTime() > Date.now() + 60 * 60_000) {
      throw new BadRequestException('The interview has not happened yet.');
    }
    await this.db.update(candidateInterviews).set(changes).where(eq(candidateInterviews.id, id));

    const all = await this.db.select().from(candidateInterviews).where(eq(candidateInterviews.candidateId, c.id));
    await this.syncCandidate(c, all);

    const moved =
      next.status === 'SCHEDULED' &&
      (new Date(next.scheduledAt).getTime() !== new Date(current.scheduledAt).getTime() ||
        next.mode !== current.mode ||
        next.meetingLink !== current.meetingLink ||
        next.location !== current.location ||
        next.durationMinutes !== current.durationMinutes);
    if (current.status === 'SCHEDULED' && next.status === 'CANCELLED') void this.notifyBoth(c.caregiverId, e, 'cancelled', next);
    else if (current.status !== 'SCHEDULED' && next.status === 'SCHEDULED') void this.notifyBoth(c.caregiverId, e, 'scheduled', next);
    else if (moved) void this.notifyBoth(c.caregiverId, e, 'changed', next);
    return this.staffGet(id);
  }

  async staffList(query: InterviewQueryDto): Promise<StaffInterview[]> {
    const when = query.when ?? 'upcoming';
    const since = new Date(Date.now() - 2 * 3600_000);
    const where =
      when === 'upcoming'
        ? and(eq(candidateInterviews.status, 'SCHEDULED'), gte(candidateInterviews.scheduledAt, since))
        : when === 'past'
          ? lt(candidateInterviews.scheduledAt, since)
          : undefined;
    const rows = await this.staffSelect()
      .where(where)
      .orderBy(when === 'upcoming' ? asc(candidateInterviews.scheduledAt) : desc(candidateInterviews.scheduledAt))
      .limit(300);
    return rows.map(toStaff);
  }

  /** Every round for each candidate, oldest first: for the staff candidate list and the employer's enquiries. */
  async forCandidates(candidateIds: string[]): Promise<Map<string, EmployerInterview[]>> {
    const out = new Map<string, EmployerInterview[]>();
    if (!candidateIds.length) return out;
    const rows = await this.db
      .select()
      .from(candidateInterviews)
      .where(inArray(candidateInterviews.candidateId, candidateIds))
      .orderBy(asc(candidateInterviews.round));
    for (const r of rows) {
      const list = out.get(r.candidateId) ?? [];
      list.push({ ...toInterview(r), feedback: r.feedback });
      out.set(r.candidateId, list);
    }
    return out;
  }

  // --- the employer ------------------------------------------------------------------

  async recordFeedback(employerId: string, id: string, feedback: string): Promise<EmployerInterview> {
    const current = await this.row(id);
    const { e } = await this.candidateWithEnquiry(current.candidateId);
    if (e.employerId !== employerId) throw new NotFoundException('Interview not found');
    if (current.status === 'CANCELLED') throw new BadRequestException('This interview was cancelled.');
    if (new Date(current.scheduledAt).getTime() > Date.now()) throw new BadRequestException('You can add feedback once the interview has taken place.');
    await this.db
      .update(candidateInterviews)
      .set({ feedback, ...(current.status === 'SCHEDULED' ? { status: 'COMPLETED' as const } : {}), updatedAt: new Date() })
      .where(eq(candidateInterviews.id, id));
    void this.notifier.toStaff(`interview feedback ${e.reference}`, {
      subject: `Interview feedback from ${e.organisationName} - ${e.reference}`,
      paragraphs: [`${e.organisationName} added feedback on an interview for enquiry ${e.reference}.`, 'Open the enquiry to read it and agree next steps.'],
      cta: { label: 'Open enquiry', url: this.notifier.staffUrl(`/international/${e.id}`) },
    });
    const after = await this.row(id);
    return { ...toInterview(after), feedback: after.feedback };
  }

  // --- the caregiver --------------------------------------------------------------------

  async forCaregiver(caregiverId: string): Promise<CaregiverInterview[]> {
    const rows = await this.db
      .select({ i: candidateInterviews, country: employerEnquiries.country, organisationType: employerEnquiries.organisationType })
      .from(candidateInterviews)
      .innerJoin(enquiryCandidates, eq(candidateInterviews.candidateId, enquiryCandidates.id))
      .innerJoin(employerEnquiries, eq(enquiryCandidates.enquiryId, employerEnquiries.id))
      .where(eq(enquiryCandidates.caregiverId, caregiverId))
      .orderBy(desc(candidateInterviews.scheduledAt))
      .limit(30);
    return rows.map(({ i, country, organisationType }) => ({ ...toInterview(i), country, organisationType }));
  }

  // --- internals ----------------------------------------------------------------------------

  private async syncCandidate(c: typeof enquiryCandidates.$inferSelect, interviews: Pick<InterviewRow, 'status' | 'scheduledAt'>[]) {
    const next = candidateAfterInterviews(c.status, interviews);
    const sameTime = (c.interviewAt ? new Date(c.interviewAt).getTime() : null) === (next.interviewAt ? next.interviewAt.getTime() : null);
    if (next.status === c.status && sameTime) return;
    await this.db.update(enquiryCandidates).set({ status: next.status, interviewAt: next.interviewAt, updatedAt: new Date() }).where(eq(enquiryCandidates.id, c.id));
  }

  private staffSelect() {
    return this.db
      .select({
        i: candidateInterviews,
        enquiryId: employerEnquiries.id,
        enquiryReference: employerEnquiries.reference,
        organisationName: employerEnquiries.organisationName,
        caregiverId: caregivers.id,
        fullName: caregivers.fullName,
        registrationNumber: caregivers.registrationNumber,
      })
      .from(candidateInterviews)
      .innerJoin(enquiryCandidates, eq(candidateInterviews.candidateId, enquiryCandidates.id))
      .innerJoin(employerEnquiries, eq(enquiryCandidates.enquiryId, employerEnquiries.id))
      .innerJoin(caregivers, eq(enquiryCandidates.caregiverId, caregivers.id))
      .$dynamic();
  }

  private async staffGet(id: string): Promise<StaffInterview> {
    const [row] = await this.staffSelect().where(eq(candidateInterviews.id, id)).limit(1);
    if (!row) throw new NotFoundException('Interview not found');
    return toStaff(row);
  }

  private async row(id: string): Promise<InterviewRow> {
    const [row] = await this.db.select().from(candidateInterviews).where(eq(candidateInterviews.id, id)).limit(1);
    if (!row) throw new NotFoundException('Interview not found');
    return row;
  }

  private async candidateWithEnquiry(candidateId: string) {
    const [row] = await this.db
      .select({ c: enquiryCandidates, e: employerEnquiries })
      .from(enquiryCandidates)
      .innerJoin(employerEnquiries, eq(enquiryCandidates.enquiryId, employerEnquiries.id))
      .where(eq(enquiryCandidates.id, candidateId))
      .limit(1);
    if (!row) throw new NotFoundException('Candidate not found');
    return row;
  }

  /** Both sides hear about it with the time and how to join. The caregiver's notice never names the employer. */
  private async notifyBoth(caregiverId: string, e: typeof employerEnquiries.$inferSelect, what: 'scheduled' | 'changed' | 'cancelled', i: InterviewRow) {
    const when = describeWhen(new Date(i.scheduledAt));
    const how = [
      i.mode === 'VIDEO' ? 'By video call.' : i.mode === 'PHONE' ? 'By phone.' : 'In person.',
      ...(i.meetingLink ? [`Join: ${i.meetingLink}`] : []),
      ...(i.location ? [`Where: ${i.location}`] : []),
      ...(i.instructions ? [i.instructions] : []),
    ];
    const lead = { scheduled: 'An interview has been arranged', changed: 'An interview has been changed', cancelled: 'An interview has been cancelled' }[what];
    const detail = what === 'cancelled' ? [`It was due on ${when}.`, ...(i.cancelReason ? [`Reason: ${i.cancelReason}`] : [])] : [`When: ${when}, for ${i.durationMinutes} minutes.`, ...how];

    await this.notifier.toAddress(e.email, `interview ${what} ${e.reference}`, {
      subject: `${lead} - ${e.reference}`,
      paragraphs: [`${lead} for your enquiry ${e.reference} (round ${i.round}).`, ...detail, 'Your employer account shows it in your own time zone, with a calendar download.'],
      cta: { label: 'Open your account', url: this.notifier.publicUrl('/employer') },
    });

    const [cg] = await this.db
      .select({ email: users.email })
      .from(caregivers)
      .innerJoin(users, eq(caregivers.userId, users.id))
      .where(eq(caregivers.id, caregiverId))
      .limit(1);
    await this.notifier.toAddress(cg?.email, `caregiver interview ${what}`, {
      subject: lead,
      paragraphs: [`${lead} with an employer in ${countryName(e.country)}.`, ...detail, 'Our team will call you to help you prepare.'],
      cta: { label: 'Open Work abroad', url: this.notifier.publicUrl('/caregiver/work-abroad') },
    });
  }
}

/** A video interview needs a link; an in-person one, a place. */
function checkMode(i: { mode: InterviewRow['mode']; meetingLink?: string | null; location?: string | null }) {
  if (i.mode === 'VIDEO' && !i.meetingLink) throw new BadRequestException('Add the video call link.');
  if (i.mode === 'IN_PERSON' && !i.location) throw new BadRequestException('Add where the interview takes place.');
}

function toStaff(r: {
  i: InterviewRow;
  enquiryId: string;
  enquiryReference: string;
  organisationName: string;
  caregiverId: string;
  fullName: string;
  registrationNumber: string;
}): StaffInterview {
  return {
    ...toInterview(r.i),
    feedback: r.i.feedback,
    enquiryId: r.enquiryId,
    enquiryReference: r.enquiryReference,
    organisationName: r.organisationName,
    caregiverId: r.caregiverId,
    fullName: r.fullName,
    registrationNumber: r.registrationNumber,
  };
}

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
