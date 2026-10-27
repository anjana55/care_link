import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID as uuid } from 'crypto';
import { and, count, desc, eq, inArray } from 'drizzle-orm';
import {
  DEFAULT_OFFER_VALID_DAYS,
  canonicalOfferTerms,
  type CandidateStatus,
  type CaregiverJobOffer,
  type EmployerJobOffer,
  type JobOffer,
  type OfferStatus,
  type OfferTerms,
  type StaffJobOffer,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { caregivers, employerEnquiries, enquiryCandidates, jobOffers, sharedProfiles, users } from '../database/schema';
import { OfferDto, OfferQueryDto, RespondOfferDto, ReviewOfferDto } from './dto/phase4.dto';
import { EmployersService } from './employers.service';
import { InternationalNotifier } from './international-notifier.service';
import { SharedProfilesService } from './shared-profiles.service';
import { iso } from './employer-enquiries.service';
import { shortReference, withUniqueRetry } from './codes';
import { addDays, todayColombo } from './dates';

type OfferRow = typeof jobOffers.$inferSelect;
type EnquiryRow = typeof employerEnquiries.$inferSelect;

/** Offers still in play: one at a time per candidate. */
export const OPEN_OFFER_STATUSES: OfferStatus[] = ['PENDING_REVIEW', 'RETURNED', 'SENT'];
const CLOSED_CANDIDATE: CandidateStatus[] = ['PLACED', 'NOT_PROCEEDING'];

export function termsHash(t: OfferTerms): string {
  return createHash('sha256').update(canonicalOfferTerms(t)).digest('hex');
}

export function termsOf(r: Pick<OfferRow, keyof OfferTerms>): OfferTerms {
  return {
    jobTitle: r.jobTitle,
    country: r.country as OfferTerms['country'],
    city: r.city,
    startDate: r.startDate,
    contractMonths: r.contractMonths,
    hoursPerWeek: r.hoursPerWeek,
    salaryAmount: Number(r.salaryAmount),
    salaryCurrency: r.salaryCurrency as OfferTerms['salaryCurrency'],
    salaryPeriod: r.salaryPeriod,
    accommodation: r.accommodation,
    mealsProvided: r.mealsProvided,
    flightsPaidBy: r.flightsPaidBy,
    annualLeaveDays: r.annualLeaveDays,
    probationMonths: r.probationMonths,
    otherTerms: r.otherTerms,
  };
}

export const isExpired = (r: Pick<OfferRow, 'status' | 'expiresOn'>, today = todayColombo()) => r.status === 'SENT' && !!r.expiresOn && r.expiresOn < today;

/** The dates an offer gives, checked. */
export function checkOfferDates(dto: Pick<OfferDto, 'startDate' | 'expiresOn'>, today = todayColombo()): void {
  if (dto.startDate && dto.startDate < today) throw new BadRequestException('The start date has passed.');
  if (dto.expiresOn && dto.expiresOn < today) throw new BadRequestException('The answer-by date has passed.');
  if (dto.startDate && dto.expiresOn && dto.expiresOn > dto.startDate) throw new BadRequestException('The caregiver must be able to answer before the start date.');
}

/** A typed signature: a name, not a tick. Letters (any script), spaces, dots, hyphens, apostrophes. */
export function checkSignature(name: string | undefined): string {
  const n = (name ?? '').trim().replace(/\s+/g, ' ');
  if (n.length < 2 || !/^[\p{L}\p{M}][\p{L}\p{M} .'-]*$/u.test(n)) throw new BadRequestException('Type your full name to sign.');
  return n;
}

function base(r: OfferRow, enquiryReference: string): JobOffer {
  return {
    ...termsOf(r),
    id: r.id,
    reference: r.reference,
    candidateId: r.candidateId,
    enquiryId: r.enquiryId,
    enquiryReference,
    status: r.status,
    expired: isExpired(r),
    expiresOn: r.expiresOn,
    employerSignature: r.employerSignatureName && r.employerSignedAt ? { name: r.employerSignatureName, signedAt: iso(r.employerSignedAt) } : null,
    caregiverSignature: r.caregiverSignatureName && r.caregiverSignedAt ? { name: r.caregiverSignatureName, signedAt: iso(r.caregiverSignedAt) } : null,
    termsHash: r.termsHash,
    reviewNote: r.reviewNote,
    declineReason: r.declineReason,
    sentAt: r.sentAt ? iso(r.sentAt) : null,
    respondedAt: r.respondedAt ? iso(r.respondedAt) : null,
    createdAt: iso(r.createdAt),
    updatedAt: iso(r.updatedAt),
  };
}

/**
 * Job offers. The employer writes the terms and signs by typing their name;
 * staff read every offer before the caregiver sees it (and can send it back);
 * the caregiver accepts by typing their own name, or declines.
 *
 * This is an offer in principle. The employment contract itself - the one a
 * visa is issued against - is signed separately, and the departure
 * checklist tracks it.
 */
@Injectable()
export class OffersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly employers: EmployersService,
    private readonly sharedProfiles: SharedProfilesService,
    private readonly notifier: InternationalNotifier,
  ) {}

  // --- the employer ------------------------------------------------------------------

  async create(employerId: string, candidateId: string, dto: OfferDto, signer: { userId: string; ip: string | null }): Promise<EmployerJobOffer> {
    await this.employers.assertVerified(employerId);
    const { c, e } = await this.candidateWithEnquiry(candidateId);
    if (e.employerId !== employerId) throw new NotFoundException('Candidate not found');
    if (CLOSED_CANDIDATE.includes(c.status)) throw new BadRequestException('This caregiver is no longer in the running for this enquiry.');
    if (!(await this.sharedProfiles.liveSlugs([c.caregiverId])).has(c.caregiverId)) throw new BadRequestException('This caregiver is no longer available.');
    const [{ n }] = await this.db
      .select({ n: count() })
      .from(jobOffers)
      .where(and(eq(jobOffers.candidateId, candidateId), inArray(jobOffers.status, OPEN_OFFER_STATUSES)));
    if (Number(n) > 0) throw new BadRequestException('There is already an offer to this caregiver. Withdraw it before making another.');
    checkOfferDates(dto);
    const signature = checkSignature(dto.signatureName);
    const terms = termsFromDto(dto);
    const id = uuid();
    await withUniqueRetry(() =>
      this.db.insert(jobOffers).values({
        id,
        reference: shortReference('OF'),
        candidateId,
        enquiryId: e.id,
        employerId,
        caregiverId: c.caregiverId,
        status: 'PENDING_REVIEW',
        ...terms,
        expiresOn: dto.expiresOn ?? null,
        termsHash: termsHash(terms),
        employerSignatureName: signature,
        employerSignedAt: new Date(),
        employerSignedByUserId: signer.userId,
        employerSignedIp: signer.ip,
      }),
    );
    void this.notifyStaff(e, `${e.organisationName} made a job offer`, 'Check it and send it to the caregiver, or return it to the employer.');
    return this.employerGet(employerId, id);
  }

  /** Changing an offer staff sent back (or have not looked at yet). The employer signs again. */
  async updateByEmployer(employerId: string, id: string, dto: OfferDto, signer: { userId: string; ip: string | null }): Promise<EmployerJobOffer> {
    const row = await this.ownRow(employerId, id);
    if (row.status !== 'PENDING_REVIEW' && row.status !== 'RETURNED') throw new BadRequestException('This offer can no longer be changed.');
    checkOfferDates(dto);
    const signature = checkSignature(dto.signatureName);
    const terms = termsFromDto(dto);
    await this.db
      .update(jobOffers)
      .set({
        ...terms,
        expiresOn: dto.expiresOn ?? null,
        termsHash: termsHash(terms),
        status: 'PENDING_REVIEW',
        employerSignatureName: signature,
        employerSignedAt: new Date(),
        employerSignedByUserId: signer.userId,
        employerSignedIp: signer.ip,
        caregiverSignatureName: null,
        caregiverSignedAt: null,
        caregiverSignedIp: null,
        updatedAt: new Date(),
      })
      .where(eq(jobOffers.id, id));
    const [e] = await this.db.select().from(employerEnquiries).where(eq(employerEnquiries.id, row.enquiryId)).limit(1);
    void this.notifyStaff(e, `${e?.organisationName ?? 'An employer'} changed a job offer`, 'Check it and send it to the caregiver, or return it to the employer.');
    return this.employerGet(employerId, id);
  }

  async withdraw(employerId: string, id: string): Promise<EmployerJobOffer> {
    const row = await this.ownRow(employerId, id);
    if (!OPEN_OFFER_STATUSES.includes(row.status)) throw new BadRequestException('This offer has already been answered or withdrawn.');
    await this.db.update(jobOffers).set({ status: 'WITHDRAWN', updatedAt: new Date() }).where(eq(jobOffers.id, id));
    const [e] = await this.db.select().from(employerEnquiries).where(eq(employerEnquiries.id, row.enquiryId)).limit(1);
    void this.notifyStaff(e, `${e?.organisationName ?? 'An employer'} withdrew job offer ${row.reference}`);
    if (row.status === 'SENT') void this.notifyCaregiver(row.caregiverId, e, 'withdrawn');
    return this.employerGet(employerId, id);
  }

  async employerList(employerId: string): Promise<EmployerJobOffer[]> {
    const rows = await this.employerSelect().where(eq(jobOffers.employerId, employerId)).orderBy(desc(jobOffers.createdAt)).limit(200);
    return rows.map(toEmployer);
  }

  async employerGet(employerId: string, id: string): Promise<EmployerJobOffer> {
    const [row] = await this.employerSelect()
      .where(and(eq(jobOffers.id, id), eq(jobOffers.employerId, employerId)))
      .limit(1);
    if (!row) throw new NotFoundException('Offer not found');
    return toEmployer(row);
  }

  /** The latest offer per candidate, as the employer sees it. */
  async latestForCandidates(candidateIds: string[]): Promise<Map<string, EmployerJobOffer>> {
    const out = new Map<string, EmployerJobOffer>();
    if (!candidateIds.length) return out;
    const rows = await this.employerSelect().where(inArray(jobOffers.candidateId, candidateIds)).orderBy(desc(jobOffers.createdAt));
    for (const r of rows) if (!out.has(r.o.candidateId)) out.set(r.o.candidateId, toEmployer(r));
    return out;
  }

  // --- staff ---------------------------------------------------------------------------

  async staffList(query: OfferQueryDto): Promise<StaffJobOffer[]> {
    const where = query.status === 'open' ? inArray(jobOffers.status, OPEN_OFFER_STATUSES) : query.status ? eq(jobOffers.status, query.status) : undefined;
    const rows = await this.staffSelect().where(where).orderBy(desc(jobOffers.updatedAt)).limit(300);
    return rows.map(toStaff);
  }

  async staffGet(id: string): Promise<StaffJobOffer> {
    const [row] = await this.staffSelect().where(eq(jobOffers.id, id)).limit(1);
    if (!row) throw new NotFoundException('Offer not found');
    return toStaff(row);
  }

  /** SEND: on to the caregiver, with an answer-by date. RETURN: back to the employer, with a note. */
  async review(id: string, dto: ReviewOfferDto, userId: string): Promise<StaffJobOffer> {
    const row = await this.row(id);
    if (row.status !== 'PENDING_REVIEW') throw new BadRequestException('Only an offer waiting for review can be sent or returned.');
    const { c, e } = await this.candidateWithEnquiry(row.candidateId);
    if (dto.action === 'RETURN') {
      if (!dto.note) throw new BadRequestException('Tell the employer what to change.');
      await this.db.update(jobOffers).set({ status: 'RETURNED', reviewNote: dto.note, reviewedByUserId: userId, updatedAt: new Date() }).where(eq(jobOffers.id, id));
      void this.notifyEmployer(e, row.reference, 'returned', dto.note);
      return this.staffGet(id);
    }
    if (CLOSED_CANDIDATE.includes(c.status)) throw new BadRequestException('This caregiver is no longer in the running for this enquiry.');
    if (termsHash(termsOf(row)) !== row.termsHash) throw new BadRequestException('The terms do not match what the employer signed. Ask them to sign again.');
    const today = todayColombo();
    const expiresOn = row.expiresOn && row.expiresOn >= today ? row.expiresOn : addDays(today, DEFAULT_OFFER_VALID_DAYS);
    await this.db
      .update(jobOffers)
      .set({ status: 'SENT', sentAt: new Date(), expiresOn, reviewNote: dto.note ?? null, reviewedByUserId: userId, updatedAt: new Date() })
      .where(eq(jobOffers.id, id));
    if (['PROPOSED', 'INTERVIEW_REQUESTED', 'INTERVIEW_SCHEDULED'].includes(c.status)) {
      await this.db.update(enquiryCandidates).set({ status: 'SELECTED', updatedAt: new Date() }).where(eq(enquiryCandidates.id, c.id));
    }
    void this.notifyCaregiver(row.caregiverId, e, 'sent');
    void this.notifyEmployer(e, row.reference, 'sent');
    return this.staffGet(id);
  }

  async pendingCount(): Promise<number> {
    const [{ n }] = await this.db.select({ n: count() }).from(jobOffers).where(eq(jobOffers.status, 'PENDING_REVIEW'));
    return Number(n);
  }

  /** The briefest view, for the staff candidate list. */
  async briefForCandidates(candidateIds: string[]): Promise<Map<string, { id: string; reference: string; status: OfferStatus; expired: boolean }>> {
    const out = new Map<string, { id: string; reference: string; status: OfferStatus; expired: boolean }>();
    if (!candidateIds.length) return out;
    const rows = await this.db
      .select({ id: jobOffers.id, reference: jobOffers.reference, status: jobOffers.status, expiresOn: jobOffers.expiresOn, candidateId: jobOffers.candidateId })
      .from(jobOffers)
      .where(inArray(jobOffers.candidateId, candidateIds))
      .orderBy(desc(jobOffers.createdAt));
    for (const r of rows) if (!out.has(r.candidateId)) out.set(r.candidateId, { id: r.id, reference: r.reference, status: r.status, expired: isExpired(r) });
    return out;
  }

  /** The accepted offer for a candidate, if any: its terms fill in the placement. */
  async acceptedFor(candidateId: string): Promise<OfferRow | null> {
    const [row] = await this.db
      .select()
      .from(jobOffers)
      .where(and(eq(jobOffers.candidateId, candidateId), eq(jobOffers.status, 'ACCEPTED')))
      .orderBy(desc(jobOffers.respondedAt))
      .limit(1);
    return row ?? null;
  }

  // --- the caregiver -----------------------------------------------------------------------

  /** Offers that reached the caregiver. Never the employer's name: staff are their contact. */
  async forCaregiver(caregiverId: string): Promise<CaregiverJobOffer[]> {
    const rows = await this.db
      .select({ o: jobOffers, organisationType: employerEnquiries.organisationType })
      .from(jobOffers)
      .innerJoin(employerEnquiries, eq(jobOffers.enquiryId, employerEnquiries.id))
      .where(and(eq(jobOffers.caregiverId, caregiverId), inArray(jobOffers.status, ['SENT', 'ACCEPTED', 'DECLINED', 'WITHDRAWN'])))
      .orderBy(desc(jobOffers.sentAt))
      .limit(20);
    return rows
      .filter(({ o }) => o.sentAt) // a withdrawn offer the caregiver never saw stays out of sight
      .map(({ o, organisationType }) => {
        const { enquiryId: _e, enquiryReference: _r, reviewNote: _n, ...rest } = base(o, '');
        return { ...rest, organisationType };
      });
  }

  /**
   * The caregiver's answer. Only the caregiver themself can sign: staff can
   * act for a caregiver elsewhere, but never put their name to an offer.
   */
  async respond(caregiverId: string, id: string, dto: RespondOfferDto, signer: { role: string; ip: string | null }): Promise<CaregiverJobOffer[]> {
    if (signer.role !== 'CAREGIVER') throw new ForbiddenException('Only the caregiver can answer their own offer.');
    const row = await this.row(id);
    if (row.caregiverId !== caregiverId) throw new NotFoundException('Offer not found');
    if (row.status !== 'SENT') throw new BadRequestException('This offer has already been answered or withdrawn.');
    if (isExpired(row)) throw new BadRequestException('This offer has passed its answer-by date. Contact our team if you still want it.');
    const { c, e } = await this.candidateWithEnquiry(row.candidateId);
    if (dto.action === 'ACCEPT') {
      if (termsHash(termsOf(row)) !== row.termsHash) throw new BadRequestException('This offer has changed. Contact our team.');
      const signature = checkSignature(dto.signatureName);
      await this.db
        .update(jobOffers)
        .set({ status: 'ACCEPTED', caregiverSignatureName: signature, caregiverSignedAt: new Date(), caregiverSignedIp: signer.ip, respondedAt: new Date(), updatedAt: new Date() })
        .where(eq(jobOffers.id, id));
      if (!CLOSED_CANDIDATE.includes(c.status) && c.status !== 'SELECTED') {
        await this.db.update(enquiryCandidates).set({ status: 'SELECTED', updatedAt: new Date() }).where(eq(enquiryCandidates.id, c.id));
      }
      void this.notifyStaff(e, `Job offer ${row.reference} accepted by the caregiver`, 'Mark the candidate Placed to start the placement and its departure checklist.');
      void this.notifyEmployer(e, row.reference, 'accepted');
    } else {
      await this.db
        .update(jobOffers)
        .set({ status: 'DECLINED', declineReason: dto.reason ?? null, respondedAt: new Date(), updatedAt: new Date() })
        .where(eq(jobOffers.id, id));
      void this.notifyStaff(e, `Job offer ${row.reference} declined by the caregiver`, 'Talk to the employer about other candidates.');
      void this.notifyEmployer(e, row.reference, 'declined');
    }
    return this.forCaregiver(caregiverId);
  }

  // --- internals --------------------------------------------------------------------------------

  private employerSelect() {
    return this.db
      .select({ o: jobOffers, enquiryReference: employerEnquiries.reference, firstName: sharedProfiles.firstName })
      .from(jobOffers)
      .innerJoin(employerEnquiries, eq(jobOffers.enquiryId, employerEnquiries.id))
      .leftJoin(sharedProfiles, eq(sharedProfiles.caregiverId, jobOffers.caregiverId))
      .$dynamic();
  }

  private staffSelect() {
    return this.db
      .select({
        o: jobOffers,
        enquiryReference: employerEnquiries.reference,
        organisationName: employerEnquiries.organisationName,
        fullName: caregivers.fullName,
        registrationNumber: caregivers.registrationNumber,
      })
      .from(jobOffers)
      .innerJoin(employerEnquiries, eq(jobOffers.enquiryId, employerEnquiries.id))
      .innerJoin(caregivers, eq(jobOffers.caregiverId, caregivers.id))
      .$dynamic();
  }

  private async row(id: string): Promise<OfferRow> {
    const [row] = await this.db.select().from(jobOffers).where(eq(jobOffers.id, id)).limit(1);
    if (!row) throw new NotFoundException('Offer not found');
    return row;
  }

  private async ownRow(employerId: string, id: string): Promise<OfferRow> {
    const row = await this.row(id).catch(() => null);
    if (!row || row.employerId !== employerId) throw new NotFoundException('Offer not found');
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

  /** `what` finishes "<organisation> ..." in the employer's case, or stands alone for the caregiver's answer. */
  private async notifyStaff(e: EnquiryRow | undefined, what: string, next = 'Open Overseas > Offers in the staff portal.') {
    if (!e) return;
    await this.notifier.toStaff(`job offer ${e.reference}`, {
      subject: `${what} - ${e.reference}`,
      paragraphs: [`${what} (enquiry ${e.reference}, ${e.organisationName}).`, next],
      cta: { label: 'Open offers', url: this.notifier.staffUrl('/international?tab=offers') },
    });
  }

  private async notifyEmployer(e: EnquiryRow, reference: string, what: 'returned' | 'sent' | 'accepted' | 'declined', note?: string) {
    const text = {
      returned: [`Our team has sent your job offer ${reference} back to you to change.`, ...(note ? [`Their note: ${note}`] : []), 'Sign in to change it and sign it again.'],
      sent: [`Your job offer ${reference} has been sent to the caregiver.`, 'We will let you know as soon as they answer.'],
      accepted: [`Good news: the caregiver accepted your job offer ${reference}.`, 'Our team will be in touch about the employment contract, the visa and travel.'],
      declined: [`The caregiver declined your job offer ${reference}.`, 'Our team will be in touch about other candidates.'],
    }[what];
    await this.notifier.toAddress(e.email, `offer ${what} ${reference}`, {
      subject: `Job offer ${reference}: ${what}`,
      paragraphs: text,
      cta: { label: 'Open your account', url: this.notifier.publicUrl('/employer/offers') },
    });
  }

  private async notifyCaregiver(caregiverId: string, e: EnquiryRow | undefined, what: 'sent' | 'withdrawn') {
    const [cg] = await this.db
      .select({ email: users.email })
      .from(caregivers)
      .innerJoin(users, eq(caregivers.userId, users.id))
      .where(eq(caregivers.id, caregiverId))
      .limit(1);
    const where = e ? ` in ${countryName(e.country)}` : '';
    await this.notifier.toAddress(cg?.email, `caregiver offer ${what}`, {
      subject: what === 'sent' ? 'You have a job offer' : 'A job offer was withdrawn',
      paragraphs:
        what === 'sent'
          ? [`An employer${where} has made you a job offer. Read the terms in Work abroad and accept or decline it there.`, 'Our team will call you to talk it through.']
          : [`The employer${where} has withdrawn their job offer. Our team will be in touch.`],
      cta: { label: 'Open Work abroad', url: this.notifier.publicUrl('/caregiver/work-abroad') },
    });
  }
}

function termsFromDto(dto: OfferDto): OfferTerms {
  return {
    jobTitle: dto.jobTitle,
    country: dto.country,
    city: dto.city ?? null,
    startDate: dto.startDate ?? null,
    contractMonths: dto.contractMonths,
    hoursPerWeek: dto.hoursPerWeek,
    salaryAmount: dto.salaryAmount,
    salaryCurrency: dto.salaryCurrency,
    salaryPeriod: dto.salaryPeriod,
    accommodation: dto.accommodation,
    mealsProvided: dto.mealsProvided,
    flightsPaidBy: dto.flightsPaidBy,
    annualLeaveDays: dto.annualLeaveDays ?? null,
    probationMonths: dto.probationMonths ?? null,
    otherTerms: dto.otherTerms ?? null,
  };
}

function toEmployer(r: { o: OfferRow; enquiryReference: string; firstName: string | null }): EmployerJobOffer {
  return { ...base(r.o, r.enquiryReference), talentFirstName: r.firstName ?? '-' };
}

function toStaff(r: { o: OfferRow; enquiryReference: string; organisationName: string; fullName: string; registrationNumber: string }): StaffJobOffer {
  return { ...base(r.o, r.enquiryReference), organisationName: r.organisationName, caregiverId: r.o.caregiverId, fullName: r.fullName, registrationNumber: r.registrationNumber };
}

function countryName(code: string): string {
  try {
    return new Intl.DisplayNames(['en'], { type: 'region' }).of(code) ?? code;
  } catch {
    return code;
  }
}
