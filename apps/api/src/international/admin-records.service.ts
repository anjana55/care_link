import { BadRequestException, ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID as uuid } from 'crypto';
import { and, count, eq, isNull, ne, type SQL } from 'drizzle-orm';
import type { MySqlTable } from 'drizzle-orm/mysql-core';
import type { EmployerAdminRow, TrainingEnrolmentRow } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  authHandoffCodes,
  candidateInterviews,
  caregivers,
  emailVerificationTokens,
  employerEnquiries,
  employerShortlist,
  employers,
  enquiryCandidates,
  jobOffers,
  overseasVacancies,
  passwordResetTokens,
  placementChecklistItems,
  placementCheckins,
  placementInvoices,
  placements,
  refreshTokens,
  socialAccounts,
  trainingCertificates,
  trainingEnrolments,
  trainingProgrammes,
  users,
  vacancyApplications,
  welfareReportMessages,
  welfareReports,
} from '../database/schema';
import { PasswordResetService } from '../auth/password-reset.service';
import { EmployersService } from './employers.service';
import { TrainingService } from './training.service';
import type { AdminCreateEmployerDto, AdminEditEmployerDto, EnrolCaregiverDto } from './dto/admin.dto';

/** What still points at a record, by name - e.g. { offers: 2, placements: 1 }. Only the non-zero ones. */
type Dependants = Record<string, number>;

/**
 * Admin-only create, edit and delete for the Overseas records that had no
 * such action: enquiries (create/delete), employer accounts (create, edit,
 * delete), candidates, vacancies, interviews, job offers, placements and
 * welfare reports (delete), and training programmes (delete) and enrolments
 * (add/remove).
 *
 * Deleting is for mistakes - a test record, a duplicate, an enquiry entered
 * twice. A record that other work hangs off is never deleted from under it:
 * the API refuses with what is in the way, and the screens offer the
 * ordinary way out instead (close the enquiry, suspend the employer, cancel
 * the interview, withdraw the offer, end the placement, deactivate the
 * programme). Anything that is a signed agreement or money stays: an
 * accepted offer, an invoice, a certificate.
 */
@Injectable()
export class AdminRecordsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly employersService: EmployersService,
    private readonly training: TrainingService,
    private readonly passwordReset: PasswordResetService,
  ) {}

  // --- enquiries -------------------------------------------------------------------------

  async deleteEnquiry(id: string): Promise<{ deleted: true; reference: string }> {
    const [row] = await this.db.select({ reference: employerEnquiries.reference }).from(employerEnquiries).where(eq(employerEnquiries.id, id)).limit(1);
    if (!row) throw new NotFoundException('Enquiry not found');
    this.refuseIf(
      await this.countAll({
        candidates: [enquiryCandidates, eq(enquiryCandidates.enquiryId, id)],
        vacancies: [overseasVacancies, eq(overseasVacancies.enquiryId, id)],
        placements: [placements, eq(placements.enquiryId, id)],
        offers: [jobOffers, eq(jobOffers.enquiryId, id)],
        invoices: [placementInvoices, eq(placementInvoices.enquiryId, id)],
      }),
      'This enquiry has candidates, vacancies, offers, placements or invoices, so it cannot be deleted. Close it instead.',
    );
    await this.db.delete(employerEnquiries).where(eq(employerEnquiries.id, id));
    return { deleted: true, reference: row.reference };
  }

  // --- employer accounts -----------------------------------------------------------------

  /**
   * Opens an employer account with no password; by default the contact is
   * emailed a link to set one. Verified by default - an admin is vouching
   * for the organisation by creating it.
   */
  async createEmployer(dto: AdminCreateEmployerDto, adminId: string): Promise<EmployerAdminRow & { passwordLinkSent: boolean }> {
    const email = dto.email.toLowerCase();
    if (!dto.organisationName || !dto.organisationType || !dto.country || !dto.contactName) {
      throw new BadRequestException('Enter the organisation name, type, country and contact name.');
    }
    const [taken] = await this.db.select({ id: users.id }).from(users).where(eq(users.email, email)).limit(1);
    if (taken) throw new ConflictException('An account with this email already exists');

    const userId = uuid();
    const employerId = uuid();
    const status = dto.status ?? 'VERIFIED';
    await this.db.transaction(async (tx) => {
      await tx.insert(users).values({
        id: userId,
        email,
        passwordHash: null,
        fullName: dto.contactName!,
        role: 'EMPLOYER',
        isActive: true,
        // The office entered the address; the password link proves it anyway.
        emailVerifiedAt: new Date(),
      });
      await tx.insert(employers).values({
        id: employerId,
        userId,
        organisationName: dto.organisationName!,
        organisationType: dto.organisationType!,
        country: dto.country!,
        contactName: dto.contactName!,
        phone: dto.phone ?? null,
        website: dto.website ?? null,
        companyRegistrationNumber: dto.companyRegistrationNumber ?? null,
        status,
        reviewedByUserId: status === 'VERIFIED' ? adminId : null,
        reviewedAt: status === 'VERIFIED' ? new Date() : null,
        consentAcceptedAt: new Date(),
      });
      if (status === 'VERIFIED') {
        // As when staff verify an account: earlier enquiries from this address join it.
        await tx
          .update(employerEnquiries)
          .set({ employerId })
          .where(and(eq(employerEnquiries.email, email), isNull(employerEnquiries.employerId)));
      }
    });
    let passwordLinkSent = false;
    if (dto.sendPasswordLink !== false) {
      await this.passwordReset.sendLinkFor(userId, adminId);
      passwordLinkSent = true;
    }
    return { ...(await this.employerRow(employerId)), passwordLinkSent };
  }

  /** Any organisation detail, verified or not, and the sign-in email. */
  async editEmployer(id: string, dto: AdminEditEmployerDto): Promise<EmployerAdminRow> {
    const [row] = await this.db.select().from(employers).where(eq(employers.id, id)).limit(1);
    if (!row) throw new NotFoundException('Employer not found');
    const changes: Partial<typeof employers.$inferInsert> = { updatedAt: new Date() };
    for (const key of ['organisationName', 'organisationType', 'country', 'contactName', 'phone', 'website', 'companyRegistrationNumber'] as const) {
      if (dto[key] !== undefined) (changes as Record<string, unknown>)[key] = dto[key];
    }
    await this.db.transaction(async (tx) => {
      if (dto.email !== undefined) {
        const email = dto.email.toLowerCase();
        const [taken] = await tx.select({ id: users.id }).from(users).where(and(eq(users.email, email), ne(users.id, row.userId))).limit(1);
        if (taken) throw new ConflictException('An account with this email already exists');
        await tx.update(users).set({ email }).where(eq(users.id, row.userId));
      }
      if (dto.contactName) await tx.update(users).set({ fullName: dto.contactName }).where(eq(users.id, row.userId));
      await tx.update(employers).set(changes).where(eq(employers.id, id));
    });
    return this.employerRow(id);
  }

  /**
   * Removes the account and its sign-in. Refused once the employer has any
   * enquiry, vacancy, offer, placement or invoice - suspend it instead, which
   * keeps the history.
   */
  async deleteEmployer(id: string): Promise<{ deleted: true; organisationName: string }> {
    const [row] = await this.db.select().from(employers).where(eq(employers.id, id)).limit(1);
    if (!row) throw new NotFoundException('Employer not found');
    this.refuseIf(
      await this.countAll({
        enquiries: [employerEnquiries, eq(employerEnquiries.employerId, id)],
        vacancies: [overseasVacancies, eq(overseasVacancies.employerId, id)],
        offers: [jobOffers, eq(jobOffers.employerId, id)],
        placements: [placements, eq(placements.employerId, id)],
        invoices: [placementInvoices, eq(placementInvoices.employerId, id)],
      }),
      'This employer has enquiries, vacancies, offers, placements or invoices, so it cannot be deleted. Suspend the account instead.',
    );
    await this.db.transaction(async (tx) => {
      await tx.delete(employerShortlist).where(eq(employerShortlist.employerId, id));
      await tx.delete(employers).where(eq(employers.id, id));
      for (const table of [refreshTokens, emailVerificationTokens, passwordResetTokens, socialAccounts, authHandoffCodes]) {
        await tx.delete(table).where(eq(table.userId, row.userId));
      }
      await tx.delete(users).where(eq(users.id, row.userId));
    });
    return { deleted: true, organisationName: row.organisationName };
  }

  // --- candidates ------------------------------------------------------------------------

  /**
   * Takes a caregiver off an enquiry (put forward by mistake). Their
   * interviews go with them; a vacancy application they came from goes back
   * to "Applied". Refused once there is an offer or a placement.
   */
  async deleteCandidate(id: string): Promise<{ deleted: true }> {
    const [row] = await this.db.select({ id: enquiryCandidates.id }).from(enquiryCandidates).where(eq(enquiryCandidates.id, id)).limit(1);
    if (!row) throw new NotFoundException('Candidate not found');
    this.refuseIf(
      await this.countAll({
        offers: [jobOffers, eq(jobOffers.candidateId, id)],
        placements: [placements, eq(placements.candidateId, id)],
      }),
      'This candidate has a job offer or a placement, so they cannot be removed. Mark them Not proceeding instead.',
    );
    await this.db.transaction(async (tx) => {
      await tx.delete(candidateInterviews).where(eq(candidateInterviews.candidateId, id));
      await tx.update(vacancyApplications).set({ candidateId: null, status: 'APPLIED', updatedAt: new Date() }).where(eq(vacancyApplications.candidateId, id));
      await tx.delete(enquiryCandidates).where(eq(enquiryCandidates.id, id));
    });
    return { deleted: true };
  }

  // --- vacancies -------------------------------------------------------------------------

  async deleteVacancy(id: string): Promise<{ deleted: true; reference: string }> {
    const [row] = await this.db.select({ reference: overseasVacancies.reference }).from(overseasVacancies).where(eq(overseasVacancies.id, id)).limit(1);
    if (!row) throw new NotFoundException('Vacancy not found');
    this.refuseIf(await this.countAll({ applications: [vacancyApplications, eq(vacancyApplications.vacancyId, id)] }), 'This vacancy has applications, so it cannot be deleted. Close it instead.');
    await this.db.delete(overseasVacancies).where(eq(overseasVacancies.id, id));
    return { deleted: true, reference: row.reference };
  }

  // --- interviews ------------------------------------------------------------------------

  /** A scheduling mistake. A real interview that did not happen is Cancelled or No-show instead. */
  async deleteInterview(id: string): Promise<{ deleted: true }> {
    const result = await this.db.delete(candidateInterviews).where(eq(candidateInterviews.id, id));
    if (!affected(result)) throw new NotFoundException('Interview not found');
    return { deleted: true };
  }

  // --- job offers ------------------------------------------------------------------------

  /** Any offer except an accepted one: that is a contract both sides signed. */
  async deleteOffer(id: string): Promise<{ deleted: true; reference: string }> {
    const [row] = await this.db.select({ reference: jobOffers.reference, status: jobOffers.status }).from(jobOffers).where(eq(jobOffers.id, id)).limit(1);
    if (!row) throw new NotFoundException('Offer not found');
    if (row.status === 'ACCEPTED') throw new ConflictException('An accepted offer is a signed agreement and cannot be deleted.');
    await this.db.delete(jobOffers).where(eq(jobOffers.id, id));
    return { deleted: true, reference: row.reference };
  }

  // --- placements ------------------------------------------------------------------------

  /**
   * A placement opened by mistake (the candidate was marked Placed too
   * early). The candidate goes back to Selected. Refused once there is an
   * invoice or a welfare report - end the placement instead.
   */
  async deletePlacement(id: string): Promise<{ deleted: true }> {
    const [row] = await this.db.select({ candidateId: placements.candidateId }).from(placements).where(eq(placements.id, id)).limit(1);
    if (!row) throw new NotFoundException('Placement not found');
    this.refuseIf(
      await this.countAll({
        invoices: [placementInvoices, eq(placementInvoices.placementId, id)],
        'welfare reports': [welfareReports, eq(welfareReports.placementId, id)],
      }),
      'This placement has an invoice or a welfare report, so it cannot be deleted. Record how it ended instead.',
    );
    await this.db.transaction(async (tx) => {
      await tx.delete(placementCheckins).where(eq(placementCheckins.placementId, id));
      await tx.delete(placementChecklistItems).where(eq(placementChecklistItems.placementId, id));
      await tx.delete(placements).where(eq(placements.id, id));
      await tx.update(enquiryCandidates).set({ status: 'SELECTED', updatedAt: new Date() }).where(and(eq(enquiryCandidates.id, row.candidateId), eq(enquiryCandidates.status, 'PLACED')));
    });
    return { deleted: true };
  }

  // --- welfare reports -------------------------------------------------------------------

  /** Only once resolved, so an open report - an SOS above all - can never just disappear. */
  async deleteWelfareReport(id: string): Promise<{ deleted: true; reference: string }> {
    const [row] = await this.db.select({ reference: welfareReports.reference, status: welfareReports.status }).from(welfareReports).where(eq(welfareReports.id, id)).limit(1);
    if (!row) throw new NotFoundException('Welfare report not found');
    if (row.status !== 'RESOLVED') throw new ConflictException('Resolve this report before deleting it.');
    await this.db.transaction(async (tx) => {
      await tx.delete(welfareReportMessages).where(eq(welfareReportMessages.reportId, id));
      await tx.delete(welfareReports).where(eq(welfareReports.id, id));
    });
    return { deleted: true, reference: row.reference };
  }

  // --- training --------------------------------------------------------------------------

  async deleteProgramme(id: string): Promise<{ deleted: true }> {
    const [row] = await this.db.select({ id: trainingProgrammes.id }).from(trainingProgrammes).where(eq(trainingProgrammes.id, id)).limit(1);
    if (!row) throw new NotFoundException('Programme not found');
    this.refuseIf(
      await this.countAll({ 'sign-ups': [trainingEnrolments, eq(trainingEnrolments.programmeId, id)] }),
      'This programme has sign-ups, so it cannot be deleted. Make it inactive instead, so it stops taking sign-ups.',
    );
    await this.db.delete(trainingProgrammes).where(eq(trainingProgrammes.id, id));
    return { deleted: true };
  }

  /** Staff signing a caregiver up (they asked in person or by phone). Works for inactive programmes too. */
  async enrol(programmeId: string, dto: EnrolCaregiverDto): Promise<TrainingEnrolmentRow[]> {
    const [programme] = await this.db.select({ id: trainingProgrammes.id }).from(trainingProgrammes).where(eq(trainingProgrammes.id, programmeId)).limit(1);
    if (!programme) throw new NotFoundException('Programme not found');
    const [caregiver] = await this.db.select({ id: caregivers.id, deletedAt: caregivers.deletedAt }).from(caregivers).where(eq(caregivers.id, dto.caregiverId)).limit(1);
    if (!caregiver || caregiver.deletedAt) throw new NotFoundException('Caregiver not found');
    const [existing] = await this.db
      .select({ id: trainingEnrolments.id })
      .from(trainingEnrolments)
      .where(and(eq(trainingEnrolments.programmeId, programmeId), eq(trainingEnrolments.caregiverId, dto.caregiverId)))
      .limit(1);
    if (existing) throw new ConflictException('This caregiver is already signed up for this programme.');
    await this.db.insert(trainingEnrolments).values({ id: uuid(), programmeId, caregiverId: dto.caregiverId, status: dto.status ?? 'ENROLLED' });
    return this.training.enrolments(programmeId);
  }

  /** A sign-up made by mistake. Refused once a certificate has been issued for it. */
  async deleteEnrolment(id: string): Promise<{ deleted: true; programmeId: string }> {
    const [row] = await this.db.select({ programmeId: trainingEnrolments.programmeId }).from(trainingEnrolments).where(eq(trainingEnrolments.id, id)).limit(1);
    if (!row) throw new NotFoundException('Enrolment not found');
    this.refuseIf(
      await this.countAll({ certificates: [trainingCertificates, eq(trainingCertificates.enrolmentId, id)] }),
      'A certificate was issued for this sign-up, so it cannot be removed. Withdraw the certificate and mark the sign-up Withdrawn instead.',
    );
    await this.db.delete(trainingEnrolments).where(eq(trainingEnrolments.id, id));
    return { deleted: true, programmeId: row.programmeId };
  }

  // --- helpers ---------------------------------------------------------------------------

  private async employerRow(id: string): Promise<EmployerAdminRow> {
    const row = (await this.employersService.adminList({ status: 'all' })).find((e) => e.id === id);
    if (!row) throw new NotFoundException('Employer not found');
    return row;
  }

  private async countAll(checks: Record<string, [MySqlTable, SQL]>): Promise<Dependants> {
    const entries = await Promise.all(
      Object.entries(checks).map(async ([name, [table, where]]) => {
        const [{ n }] = await this.db.select({ n: count() }).from(table).where(where);
        return [name, Number(n)] as const;
      }),
    );
    return Object.fromEntries(entries.filter(([, n]) => n > 0));
  }

  /**
   * Refuses (409) while anything still points at the record. The message names
   * what kinds of record can be in the way, in plain words that translate.
   */
  private refuseIf(dependants: Dependants, message: string) {
    if (Object.keys(dependants).length) throw new ConflictException(message);
  }
}

function affected(result: unknown): number {
  const header = Array.isArray(result) ? result[0] : result;
  return (header as { affectedRows?: number })?.affectedRows ?? 0;
}
