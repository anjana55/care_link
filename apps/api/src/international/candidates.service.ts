import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID as uuid } from 'crypto';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import type {
  CandidateSource,
  CandidateStatus,
  CaregiverEmployerInterest,
  EmployerCandidate,
  EmployerOwnEnquiry,
  StaffCandidate,
  StaffCandidateWithEnquiry,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { caregivers, employerEnquiries, enquiryCandidates, placements, users } from '../database/schema';
import { EmployerCandidateActionDto, InterviewRequestDto, ProposeCandidateDto, UpdateCandidateDto } from './dto/international.dto';
import { SharedProfilesService } from './shared-profiles.service';
import { EmployersService } from './employers.service';
import { InternationalNotifier } from './international-notifier.service';
import { OPEN_ENQUIRY_STATUSES, iso } from './employer-enquiries.service';
import { PlacementsService } from './placements.service';

type CandidateRow = typeof enquiryCandidates.$inferSelect;
type EnquiryRow = typeof employerEnquiries.$inferSelect;

/** Where a candidate can go next when the employer acts. Anything else is refused. */
const EMPLOYER_MOVES: Record<EmployerCandidateActionDto['action'], { from: CandidateStatus[]; to: CandidateStatus }> = {
  REQUEST_INTERVIEW: { from: ['PROPOSED'], to: 'INTERVIEW_REQUESTED' },
  SELECT: { from: ['PROPOSED', 'INTERVIEW_REQUESTED', 'INTERVIEW_SCHEDULED'], to: 'SELECTED' },
  DECLINE: { from: ['PROPOSED', 'INTERVIEW_REQUESTED', 'INTERVIEW_SCHEDULED', 'SELECTED'], to: 'NOT_PROCEEDING' },
};

const isOpen = (e: Pick<EnquiryRow, 'status'>) => (OPEN_ENQUIRY_STATUSES as readonly string[]).includes(e.status);

/**
 * Caregivers on an employer's enquiry - put forward by staff, or asked about
 * by a verified employer - and how each one moves towards an interview and a
 * placement.
 *
 * The rule that holds everything together: a caregiver is only ever a
 * candidate while their shared profile is live. That profile, which they
 * consented to and staff reviewed, is the only way an employer sees them.
 * Contact always goes through staff.
 */
@Injectable()
export class CandidatesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly sharedProfiles: SharedProfilesService,
    private readonly employers: EmployersService,
    private readonly notifier: InternationalNotifier,
    private readonly placements: PlacementsService,
  ) {}

  // --- staff -------------------------------------------------------------------

  async listForEnquiry(enquiryId: string): Promise<StaffCandidate[]> {
    const rows = await this.db
      .select({ c: enquiryCandidates, registrationNumber: caregivers.registrationNumber, fullName: caregivers.fullName, placementId: placements.id })
      .from(enquiryCandidates)
      .innerJoin(caregivers, eq(enquiryCandidates.caregiverId, caregivers.id))
      .leftJoin(placements, eq(placements.candidateId, enquiryCandidates.id))
      .where(eq(enquiryCandidates.enquiryId, enquiryId))
      .orderBy(asc(enquiryCandidates.createdAt));
    const live = await this.sharedProfiles.liveSlugs(rows.map((r) => r.c.caregiverId));
    return rows.map((r) => ({ ...toStaffCandidate(r.c, r.registrationNumber, r.fullName, live.get(r.c.caregiverId) ?? null), placementId: r.placementId ?? null }));
  }

  async propose(
    enquiryId: string,
    dto: ProposeCandidateDto,
    { source = 'STAFF', notifyCaregiver = true }: { source?: CandidateSource; notifyCaregiver?: boolean } = {},
  ): Promise<StaffCandidate[]> {
    const enquiry = await this.enquiry(enquiryId);
    if (!isOpen(enquiry)) throw new BadRequestException('This enquiry is no longer open.');
    const slug = (await this.sharedProfiles.liveSlugs([dto.caregiverId])).get(dto.caregiverId);
    if (!slug) throw new BadRequestException('Only caregivers with a live shared profile can be put forward - it is the only way an employer can see them.');

    const [existing] = await this.db
      .select()
      .from(enquiryCandidates)
      .where(and(eq(enquiryCandidates.enquiryId, enquiryId), eq(enquiryCandidates.caregiverId, dto.caregiverId)))
      .limit(1);
    if (existing && existing.status !== 'NOT_PROCEEDING') throw new BadRequestException('This caregiver is already on the enquiry.');
    if (existing) {
      await this.db
        .update(enquiryCandidates)
        .set({ status: 'PROPOSED', source, messageToEmployer: dto.messageToEmployer ?? null, interviewAt: null, updatedAt: new Date() })
        .where(eq(enquiryCandidates.id, existing.id));
    } else {
      await this.db.insert(enquiryCandidates).values({
        id: uuid(),
        enquiryId,
        caregiverId: dto.caregiverId,
        source,
        status: 'PROPOSED',
        messageToEmployer: dto.messageToEmployer ?? null,
      });
    }
    if (enquiry.status !== 'INTRODUCED') {
      await this.db.update(employerEnquiries).set({ status: 'INTRODUCED', updatedAt: new Date() }).where(eq(employerEnquiries.id, enquiryId));
    }
    void this.notifyEmployer(enquiry, 'proposed');
    if (notifyCaregiver) void this.notifyCaregiver(dto.caregiverId, enquiry, 'interest');
    return this.listForEnquiry(enquiryId);
  }

  async update(candidateId: string, dto: UpdateCandidateDto, userId?: string): Promise<StaffCandidate> {
    const candidate = await this.candidate(candidateId);
    const changes: Partial<typeof enquiryCandidates.$inferInsert> = { updatedAt: new Date() };
    if (dto.status !== undefined) changes.status = dto.status;
    if (dto.interviewAt !== undefined) changes.interviewAt = dto.interviewAt ? new Date(dto.interviewAt) : null;
    if (dto.messageToEmployer !== undefined) changes.messageToEmployer = dto.messageToEmployer;
    if (dto.staffNote !== undefined) changes.staffNote = dto.staffNote;
    const status = changes.status ?? candidate.status;
    if (status === 'INTERVIEW_SCHEDULED' && !(changes.interviewAt ?? candidate.interviewAt)) {
      throw new BadRequestException('Set the interview date and time.');
    }
    await this.db.update(enquiryCandidates).set(changes).where(eq(enquiryCandidates.id, candidateId));
    // Hired: placement tracking starts here (welfare check-ins, the fee invoice).
    if (status === 'PLACED' && candidate.status !== 'PLACED') await this.placements.openForCandidate(candidateId, userId ?? null);

    const scheduled = status === 'INTERVIEW_SCHEDULED' && (candidate.status !== 'INTERVIEW_SCHEDULED' || dto.interviewAt !== undefined);
    if (scheduled) {
      const enquiry = await this.enquiry(candidate.enquiryId);
      void this.notifyEmployer(enquiry, 'scheduled');
      void this.notifyCaregiver(candidate.caregiverId, enquiry, 'interview');
    }
    return (await this.listForEnquiry(candidate.enquiryId)).find((c) => c.id === candidateId)!;
  }

  /** Employers waiting for staff to arrange an interview, oldest first. */
  async interviewRequests(): Promise<StaffCandidateWithEnquiry[]> {
    const rows = await this.db
      .select({
        c: enquiryCandidates,
        registrationNumber: caregivers.registrationNumber,
        fullName: caregivers.fullName,
        reference: employerEnquiries.reference,
        organisationName: employerEnquiries.organisationName,
        country: employerEnquiries.country,
      })
      .from(enquiryCandidates)
      .innerJoin(caregivers, eq(enquiryCandidates.caregiverId, caregivers.id))
      .innerJoin(employerEnquiries, eq(enquiryCandidates.enquiryId, employerEnquiries.id))
      .where(eq(enquiryCandidates.status, 'INTERVIEW_REQUESTED'))
      .orderBy(asc(enquiryCandidates.updatedAt))
      .limit(200);
    const live = await this.sharedProfiles.liveSlugs(rows.map((r) => r.c.caregiverId));
    return rows.map((r) => ({
      ...toStaffCandidate(r.c, r.registrationNumber, r.fullName, live.get(r.c.caregiverId) ?? null),
      placementId: null,
      enquiry: { id: r.c.enquiryId, reference: r.reference, organisationName: r.organisationName, country: r.country },
    }));
  }

  async interviewRequestCount(): Promise<number> {
    const [{ n }] = await this.db.select({ n: count() }).from(enquiryCandidates).where(eq(enquiryCandidates.status, 'INTERVIEW_REQUESTED'));
    return Number(n);
  }

  // --- the employer ---------------------------------------------------------------

  /** The employer's enquiries, newest first, each with its candidates as the employer may see them. */
  async ownEnquiries(employerId: string, locale?: string): Promise<EmployerOwnEnquiry[]> {
    const enquiries = await this.db
      .select()
      .from(employerEnquiries)
      .where(eq(employerEnquiries.employerId, employerId))
      .orderBy(desc(employerEnquiries.createdAt))
      .limit(100);
    if (!enquiries.length) return [];
    const candidates = await this.db
      .select()
      .from(enquiryCandidates)
      .where(
        inArray(
          enquiryCandidates.enquiryId,
          enquiries.map((e) => e.id),
        ),
      )
      .orderBy(asc(enquiryCandidates.createdAt));
    const cards = await this.sharedProfiles.liveCards(
      candidates.map((c) => c.caregiverId),
      locale,
    );
    return enquiries.map((e) => ({
      id: e.id,
      reference: e.reference,
      status: e.status,
      country: e.country,
      rolesCount: e.rolesCount,
      careSettings: e.careSettings ?? [],
      createdAt: iso(e.createdAt),
      candidates: candidates
        .filter((c) => c.enquiryId === e.id)
        .map(
          (c): EmployerCandidate => ({
            id: c.id,
            status: c.status,
            interviewAt: c.interviewAt ? iso(c.interviewAt) : null,
            messageToEmployer: c.messageToEmployer,
            // A caregiver who stopped sharing is not shown at all - only that someone is no longer available.
            talent: cards.get(c.caregiverId) ?? null,
          }),
        ),
    }));
  }

  /** "I'd like to interview her" - from a shared profile or the shortlist, onto one of the employer's open enquiries. */
  async requestInterview(employerId: string, dto: InterviewRequestDto, locale?: string): Promise<EmployerOwnEnquiry[]> {
    await this.employers.assertVerified(employerId);
    const enquiry = await this.ownEnquiry(employerId, dto.enquiryId);
    if (!isOpen(enquiry)) throw new BadRequestException('This enquiry is no longer open.');
    const caregiverId = await this.sharedProfiles.liveCaregiverIdForSlug(dto.talentSlug);
    if (!caregiverId) throw new NotFoundException('Profile not found');

    const [existing] = await this.db
      .select()
      .from(enquiryCandidates)
      .where(and(eq(enquiryCandidates.enquiryId, enquiry.id), eq(enquiryCandidates.caregiverId, caregiverId)))
      .limit(1);
    if (existing && existing.status !== 'PROPOSED' && existing.status !== 'NOT_PROCEEDING') {
      throw new BadRequestException('You have already asked about this caregiver on this enquiry.');
    }
    if (existing) {
      await this.db
        .update(enquiryCandidates)
        .set({ status: 'INTERVIEW_REQUESTED', employerMessage: dto.message ?? null, updatedAt: new Date() })
        .where(eq(enquiryCandidates.id, existing.id));
    } else {
      await this.db.insert(enquiryCandidates).values({
        id: uuid(),
        enquiryId: enquiry.id,
        caregiverId,
        source: 'EMPLOYER',
        status: 'INTERVIEW_REQUESTED',
        employerMessage: dto.message ?? null,
      });
    }
    void this.notifyStaffOfRequest(enquiry, 'asked to interview a caregiver');
    void this.notifyCaregiver(caregiverId, enquiry, 'interest');
    return this.ownEnquiries(employerId, locale);
  }

  async employerAction(employerId: string, candidateId: string, dto: EmployerCandidateActionDto, locale?: string): Promise<EmployerOwnEnquiry[]> {
    const candidate = await this.candidate(candidateId);
    const enquiry = await this.ownEnquiry(employerId, candidate.enquiryId);
    if (dto.action !== 'DECLINE') await this.employers.assertVerified(employerId);
    const move = EMPLOYER_MOVES[dto.action];
    if (!move.from.includes(candidate.status)) throw new BadRequestException('That is not possible for this caregiver right now.');
    if (dto.action !== 'DECLINE' && !(await this.sharedProfiles.liveSlugs([candidate.caregiverId])).has(candidate.caregiverId)) {
      throw new BadRequestException('This caregiver is no longer available.');
    }
    await this.db
      .update(enquiryCandidates)
      .set({ status: move.to, ...(dto.message ? { employerMessage: dto.message } : {}), updatedAt: new Date() })
      .where(eq(enquiryCandidates.id, candidateId));
    const what = { REQUEST_INTERVIEW: 'asked to interview a caregiver', SELECT: 'wants to hire a caregiver', DECLINE: 'is not proceeding with a caregiver' }[dto.action];
    void this.notifyStaffOfRequest(enquiry, what);
    return this.ownEnquiries(employerId, locale);
  }

  // --- the caregiver ---------------------------------------------------------------

  /** Employer interest in this caregiver - the country and kind of employer only, never who. */
  async interestFor(caregiverId: string): Promise<CaregiverEmployerInterest[]> {
    const rows = await this.db
      .select({ c: enquiryCandidates, country: employerEnquiries.country, organisationType: employerEnquiries.organisationType })
      .from(enquiryCandidates)
      .innerJoin(employerEnquiries, eq(enquiryCandidates.enquiryId, employerEnquiries.id))
      .where(eq(enquiryCandidates.caregiverId, caregiverId))
      .orderBy(desc(enquiryCandidates.updatedAt))
      .limit(50);
    return rows.map(({ c, country, organisationType }) => ({
      id: c.id,
      country,
      organisationType,
      status: c.status,
      interviewAt: c.interviewAt ? iso(c.interviewAt) : null,
      createdAt: iso(c.createdAt),
    }));
  }

  // --- internals ------------------------------------------------------------------

  private async enquiry(id: string): Promise<EnquiryRow> {
    const [row] = await this.db.select().from(employerEnquiries).where(eq(employerEnquiries.id, id)).limit(1);
    if (!row) throw new NotFoundException('Enquiry not found');
    return row;
  }

  /** One of this employer's own enquiries - someone else's reads as not found. */
  private async ownEnquiry(employerId: string, enquiryId: string): Promise<EnquiryRow> {
    const row = await this.enquiry(enquiryId).catch(() => null);
    if (!row || row.employerId !== employerId) throw new NotFoundException('Enquiry not found');
    return row;
  }

  private async candidate(id: string): Promise<CandidateRow> {
    const [row] = await this.db.select().from(enquiryCandidates).where(eq(enquiryCandidates.id, id)).limit(1);
    if (!row) throw new NotFoundException('Candidate not found');
    return row;
  }

  private async notifyEmployer(enquiry: EnquiryRow, what: 'proposed' | 'scheduled') {
    const url = enquiry.employerId ? this.notifier.publicUrl('/employer') : this.notifier.publicUrl('/international');
    const notice =
      what === 'proposed'
        ? {
            subject: `A caregiver has been put forward - ${enquiry.reference}`,
            paragraphs: [
              `Our team has put forward a caregiver for your enquiry ${enquiry.reference}.`,
              enquiry.employerId
                ? 'Sign in to your employer account to see their profile and ask for an interview.'
                : 'Reply to this email, or create an employer account with this address, to see their profile and ask for an interview.',
            ],
          }
        : {
            subject: `Interview arranged - ${enquiry.reference}`,
            paragraphs: [`An interview has been arranged for your enquiry ${enquiry.reference}.`, 'Sign in to your employer account for the date, time and details.'],
          };
    await this.notifier.toAddress(enquiry.email, `employer ${what} ${enquiry.reference}`, { ...notice, cta: { label: 'Open', url } });
  }

  private async notifyStaffOfRequest(enquiry: EnquiryRow, what: string) {
    await this.notifier.toStaff(`employer action ${enquiry.reference}`, {
      subject: `${enquiry.organisationName} ${what} - ${enquiry.reference}`,
      paragraphs: [`${enquiry.organisationName} ${what} on enquiry ${enquiry.reference}.`, 'Open the enquiry in the staff portal to follow up.'],
      cta: { label: 'Open enquiry', url: this.notifier.staffUrl(`/international/${enquiry.id}`) },
    });
  }

  /**
   * The caregiver hears that an employer is interested, or that an interview
   * is arranged - in general terms only. Staff call them with the details.
   */
  private async notifyCaregiver(caregiverId: string, enquiry: EnquiryRow, what: 'interest' | 'interview') {
    const [row] = await this.db
      .select({ email: users.email })
      .from(caregivers)
      .innerJoin(users, eq(caregivers.userId, users.id))
      .where(eq(caregivers.id, caregiverId))
      .limit(1);
    const notice =
      what === 'interest'
        ? {
            subject: 'An employer abroad is interested in you',
            paragraphs: [
              `An employer in ${countryName(enquiry.country)} is interested in your shared profile. Our team will contact you before anything is arranged.`,
            ],
          }
        : {
            subject: 'An interview has been arranged',
            paragraphs: [`An interview with an employer in ${countryName(enquiry.country)} has been arranged. Our team will contact you with the details.`],
          };
    await this.notifier.toAddress(row?.email, `caregiver ${what}`, {
      ...notice,
      cta: { label: 'Open Work abroad', url: this.notifier.publicUrl('/caregiver/work-abroad') },
    });
  }
}

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}

function toStaffCandidate(c: CandidateRow, registrationNumber: string, fullName: string, slug: string | null): Omit<StaffCandidate, 'placementId'> {
  return {
    id: c.id,
    caregiverId: c.caregiverId,
    registrationNumber,
    fullName,
    talentSlug: slug,
    profileLive: Boolean(slug),
    source: c.source,
    status: c.status,
    interviewAt: c.interviewAt ? iso(c.interviewAt) : null,
    messageToEmployer: c.messageToEmployer,
    employerMessage: c.employerMessage,
    staffNote: c.staffNote,
    createdAt: iso(c.createdAt),
    updatedAt: iso(c.updatedAt),
  };
}

