import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt, randomUUID as uuid } from 'crypto';
import { and, count, desc, eq, gte, inArray, isNull, like, ne, or, type SQL } from 'drizzle-orm';
import type {
  CaregiverVacancyApplication,
  PublicVacancy,
  PublicVacancyList,
  StaffVacancy,
  StaffVacancyApplication,
  Vacancy,
  VacancyStatus,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { caregivers, employerEnquiries, employers, overseasVacancies, users, vacancyApplications } from '../database/schema';
import { ApplyVacancyDto, ReviewVacancyDto, StaffVacancyDto, StaffVacancyQueryDto, UpdateApplicationDto, VacancyDto, VacancyQueryDto } from './dto/phase3.dto';
import { EmployerEnquiriesService, OPEN_ENQUIRY_STATUSES, iso } from './employer-enquiries.service';
import { EmployersService } from './employers.service';
import { CandidatesService } from './candidates.service';
import { ReadinessService } from './readiness.service';
import { SharedProfilesService } from './shared-profiles.service';
import { InternationalNotifier } from './international-notifier.service';
import { todayColombo } from './dates';

type VacancyRow = typeof overseasVacancies.$inferSelect;
type ApplicationRow = typeof vacancyApplications.$inferSelect;

const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';
export function generateVacancyReference(): string {
  let out = 'VC-';
  for (let i = 0; i < 6; i++) out += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return out;
}

/** Applications a caregiver may have waiting at once - enough to try several, not enough to spray every vacancy. */
export const MAX_OPEN_APPLICATIONS = 10;

/** An employer may change a vacancy only before it goes live; after that, they close it and staff can edit. */
const EMPLOYER_EDITABLE: VacancyStatus[] = ['PENDING_REVIEW', 'REJECTED'];
const CLOSABLE: VacancyStatus[] = ['PENDING_REVIEW', 'PUBLISHED', 'REJECTED'];

/** On the board and taking applications. */
export function isVacancyOpen(v: Pick<VacancyRow, 'status' | 'closesOn'>, today = todayColombo()): boolean {
  return v.status === 'PUBLISHED' && (!v.closesOn || v.closesOn >= today);
}

/** Salary given as a range must make sense, and an amount needs its currency and period. */
export function checkSalary(dto: Pick<VacancyDto, 'salaryMin' | 'salaryMax' | 'salaryCurrency' | 'salaryPeriod'>): void {
  const min = dto.salaryMin ?? null;
  const max = dto.salaryMax ?? null;
  if (min !== null && max !== null && max < min) throw new BadRequestException('The highest salary cannot be below the lowest.');
  if ((min !== null || max !== null) && (!dto.salaryCurrency || !dto.salaryPeriod)) {
    throw new BadRequestException('Give the salary currency and whether it is per hour, month or year.');
  }
}

const isDuplicate = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e.code ?? e.cause?.code) === 'ER_DUP_ENTRY';
};

/**
 * The vacancy board: jobs abroad that verified employers post (and staff
 * review), or staff post for an enquiry they are working.
 *
 * Every vacancy sits on an enquiry. A caregiver applies; staff decide who to
 * put forward, and those become the enquiry's candidates - the same path to
 * interview and placement as any other introduction. Caregivers never see who
 * the employer is, and the employer never sees an applicant until staff put
 * them forward through their shared profile.
 */
@Injectable()
export class VacanciesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly enquiries: EmployerEnquiriesService,
    private readonly employers: EmployersService,
    private readonly candidates: CandidatesService,
    private readonly readiness: ReadinessService,
    private readonly sharedProfiles: SharedProfilesService,
    private readonly notifier: InternationalNotifier,
  ) {}

  // --- the employer -----------------------------------------------------------------

  async createForEmployer(employerId: string, dto: VacancyDto, userId: string): Promise<Vacancy> {
    const employer = await this.employers.assertVerified(employerId).catch((err: unknown) => {
      if (err instanceof ForbiddenException) throw new ForbiddenException('Your organisation must be verified by our team before you can post vacancies.');
      throw err;
    });
    checkSalary(dto);
    const enquiry = await this.enquiries.createForVacancy(employerId, {
      country: dto.country,
      rolesCount: dto.rolesCount,
      careSetting: dto.careSetting,
      visaSponsorship: dto.visaSponsorship,
      startTimeframe: dto.startTimeframe ?? null,
      title: dto.title,
    });
    const id = await this.insert({ ...this.values(dto), enquiryId: enquiry.id, employerId, status: 'PENDING_REVIEW', createdByUserId: userId });
    const v = await this.row(id);
    void this.notifier.toStaff(`vacancy ${v.reference}`, {
      subject: `New vacancy to review - ${v.reference}`,
      paragraphs: [`${employer.organisationName} posted a vacancy: "${v.title}" (${v.rolesCount} role${v.rolesCount === 1 ? '' : 's'}, ${v.country}).`, 'Check it and publish it to the vacancy board, or send it back with a note.'],
      cta: { label: 'Review vacancy', url: this.notifier.staffUrl(`/international?tab=vacancies`) },
    });
    return (await this.listForEmployer(employerId)).find((x) => x.id === id)!;
  }

  async listForEmployer(employerId: string): Promise<Vacancy[]> {
    const rows = await this.select().where(eq(overseasVacancies.employerId, employerId)).orderBy(desc(overseasVacancies.createdAt)).limit(100);
    const counts = await this.applicationCounts(rows.map((r) => r.v.id));
    return rows.map((r) => toVacancy(r, counts.get(r.v.id)?.total ?? 0));
  }

  async updateForEmployer(employerId: string, id: string, dto: VacancyDto): Promise<Vacancy> {
    const v = await this.ownVacancy(employerId, id);
    if (!EMPLOYER_EDITABLE.includes(v.status)) throw new BadRequestException('A live vacancy cannot be changed. Close it, or ask our team to change it.');
    checkSalary(dto);
    // An edit goes back for review, whatever staff said last time.
    await this.db
      .update(overseasVacancies)
      .set({ ...this.values(dto), status: 'PENDING_REVIEW', updatedAt: new Date() })
      .where(eq(overseasVacancies.id, id));
    return (await this.listForEmployer(employerId)).find((x) => x.id === id)!;
  }

  async closeForEmployer(employerId: string, id: string): Promise<Vacancy> {
    const v = await this.ownVacancy(employerId, id);
    if (!CLOSABLE.includes(v.status)) throw new BadRequestException('This vacancy is already closed.');
    await this.db.update(overseasVacancies).set({ status: 'CLOSED', updatedAt: new Date() }).where(eq(overseasVacancies.id, id));
    return (await this.listForEmployer(employerId)).find((x) => x.id === id)!;
  }

  // --- staff ------------------------------------------------------------------------------

  async staffList(query: StaffVacancyQueryDto): Promise<StaffVacancy[]> {
    const rows = await this.select()
      .where(and(query.status ? eq(overseasVacancies.status, query.status) : undefined, query.enquiryId ? eq(overseasVacancies.enquiryId, query.enquiryId) : undefined))
      .orderBy(desc(overseasVacancies.createdAt))
      .limit(200);
    const counts = await this.applicationCounts(rows.map((r) => r.v.id));
    return rows.map((r) => toStaffVacancy(r, counts.get(r.v.id)));
  }

  async staffGet(id: string): Promise<StaffVacancy> {
    const [row] = await this.select().where(eq(overseasVacancies.id, id)).limit(1);
    if (!row) throw new NotFoundException('Vacancy not found');
    const counts = await this.applicationCounts([id]);
    return toStaffVacancy(row, counts.get(id));
  }

  /** Staff post straight to the board, for an enquiry they are working. */
  async createByStaff(dto: StaffVacancyDto, userId: string): Promise<StaffVacancy> {
    const [enquiry] = await this.db.select().from(employerEnquiries).where(eq(employerEnquiries.id, dto.enquiryId)).limit(1);
    if (!enquiry) throw new NotFoundException('Enquiry not found');
    if (!(OPEN_ENQUIRY_STATUSES as readonly string[]).includes(enquiry.status)) throw new BadRequestException('This enquiry is no longer open.');
    checkSalary(dto);
    const now = new Date();
    const id = await this.insert({
      ...this.values(dto),
      enquiryId: enquiry.id,
      employerId: enquiry.employerId,
      status: 'PUBLISHED',
      publishedAt: now,
      reviewedAt: now,
      reviewedByUserId: userId,
      createdByUserId: userId,
    });
    return this.staffGet(id);
  }

  async updateByStaff(id: string, dto: VacancyDto): Promise<StaffVacancy> {
    await this.row(id);
    checkSalary(dto);
    await this.db
      .update(overseasVacancies)
      .set({ ...this.values(dto), updatedAt: new Date() })
      .where(eq(overseasVacancies.id, id));
    return this.staffGet(id);
  }

  async review(id: string, dto: ReviewVacancyDto, userId: string): Promise<StaffVacancy> {
    const v = await this.row(id);
    if (dto.status === 'REJECTED' && !dto.note) throw new BadRequestException('Tell the employer why.');
    const now = new Date();
    await this.db
      .update(overseasVacancies)
      .set({
        status: dto.status,
        reviewNote: dto.note ?? null,
        reviewedByUserId: userId,
        reviewedAt: now,
        ...(dto.status === 'PUBLISHED' && !v.publishedAt ? { publishedAt: now } : {}),
        updatedAt: now,
      })
      .where(eq(overseasVacancies.id, id));
    if (v.status !== dto.status && (dto.status === 'PUBLISHED' || dto.status === 'REJECTED')) void this.notifyEmployerOfReview(v, dto.status, dto.note ?? null);
    return this.staffGet(id);
  }

  async applications(vacancyId: string): Promise<StaffVacancyApplication[]> {
    await this.row(vacancyId);
    const rows = await this.db
      .select({ a: vacancyApplications, registrationNumber: caregivers.registrationNumber, fullName: caregivers.fullName })
      .from(vacancyApplications)
      .innerJoin(caregivers, eq(vacancyApplications.caregiverId, caregivers.id))
      .where(eq(vacancyApplications.vacancyId, vacancyId))
      .orderBy(desc(vacancyApplications.createdAt));
    const ids = rows.map((r) => r.a.caregiverId);
    const [reports, live] = await Promise.all([this.readiness.forCaregivers(ids), this.sharedProfiles.liveSlugs(ids)]);
    return rows
      .filter((r) => reports.has(r.a.caregiverId))
      .map((r) => toStaffApplication(r.a, r.registrationNumber, r.fullName, live.has(r.a.caregiverId), reports.get(r.a.caregiverId)!));
  }

  /**
   * Staff decide on an application. Putting someone forward makes them a
   * candidate on the vacancy's enquiry - which needs their shared profile to
   * be live, since that is all the employer will ever see of them.
   */
  async updateApplication(applicationId: string, dto: UpdateApplicationDto): Promise<StaffVacancyApplication> {
    const a = await this.application(applicationId);
    const v = await this.row(a.vacancyId);
    if (a.status === 'WITHDRAWN') throw new BadRequestException('The caregiver withdrew this application.');
    const changes: Partial<typeof vacancyApplications.$inferInsert> = { updatedAt: new Date() };
    if (dto.staffNote !== undefined) changes.staffNote = dto.staffNote;

    if (dto.status && dto.status !== a.status) {
      if (a.status === 'PUT_FORWARD') throw new BadRequestException('This caregiver is already a candidate - follow them on the enquiry.');
      if (dto.status === 'PUT_FORWARD') {
        const list = await this.candidates.propose(v.enquiryId, { caregiverId: a.caregiverId, messageToEmployer: dto.messageToEmployer ?? undefined }, { source: 'APPLICATION', notifyCaregiver: false });
        changes.candidateId = list.find((c) => c.caregiverId === a.caregiverId)?.id ?? null;
      }
      changes.status = dto.status;
    }
    await this.db.update(vacancyApplications).set(changes).where(eq(vacancyApplications.id, applicationId));
    if (changes.status === 'PUT_FORWARD' || changes.status === 'NOT_SUCCESSFUL') void this.notifyApplicant(a.caregiverId, v, changes.status);
    return (await this.applications(a.vacancyId)).find((x) => x.id === applicationId)!;
  }

  async pendingCount(): Promise<number> {
    const [{ n }] = await this.db.select({ n: count() }).from(overseasVacancies).where(eq(overseasVacancies.status, 'PENDING_REVIEW'));
    return Number(n);
  }

  async newApplicationCount(): Promise<number> {
    const [{ n }] = await this.db.select({ n: count() }).from(vacancyApplications).where(eq(vacancyApplications.status, 'APPLIED'));
    return Number(n);
  }

  // --- the public board ---------------------------------------------------------------------

  async publicList(query: VacancyQueryDto): Promise<PublicVacancyList> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 20;
    const term = query.search ? `%${query.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
    const where = and(
      this.openCondition(),
      query.country ? eq(overseasVacancies.country, query.country) : undefined,
      query.careSetting ? eq(overseasVacancies.careSetting, query.careSetting) : undefined,
      term ? or(like(overseasVacancies.title, term), like(overseasVacancies.city, term)) : undefined,
    );
    const [rows, [{ total }]] = await Promise.all([
      this.select()
        .where(where)
        .orderBy(desc(overseasVacancies.publishedAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db.select({ total: count() }).from(overseasVacancies).where(where),
    ]);
    return { items: rows.map(toPublicVacancy), page, pageSize, total: Number(total) };
  }

  async publicGet(reference: string): Promise<PublicVacancy> {
    const [row] = await this.select()
      .where(and(eq(overseasVacancies.reference, reference.toUpperCase()), this.openCondition()))
      .limit(1);
    if (!row) throw new NotFoundException('Vacancy not found');
    return toPublicVacancy(row);
  }

  // --- the caregiver --------------------------------------------------------------------------

  async apply(caregiverId: string, reference: string, dto: ApplyVacancyDto): Promise<CaregiverVacancyApplication[]> {
    const [v] = await this.db.select().from(overseasVacancies).where(eq(overseasVacancies.reference, reference.toUpperCase())).limit(1);
    if (!v || !isVacancyOpen(v)) throw new NotFoundException('Vacancy not found');
    const [existing] = await this.db
      .select()
      .from(vacancyApplications)
      .where(and(eq(vacancyApplications.vacancyId, v.id), eq(vacancyApplications.caregiverId, caregiverId)))
      .limit(1);
    if (existing && existing.status !== 'WITHDRAWN') throw new BadRequestException('You have already applied for this vacancy.');
    const [{ n }] = await this.db
      .select({ n: count() })
      .from(vacancyApplications)
      .where(and(eq(vacancyApplications.caregiverId, caregiverId), eq(vacancyApplications.status, 'APPLIED')));
    if (Number(n) >= MAX_OPEN_APPLICATIONS) {
      throw new BadRequestException('You can have up to 10 applications waiting at once. Withdraw one, or wait for our team to reply.');
    }
    if (existing) {
      await this.db
        .update(vacancyApplications)
        .set({ status: 'APPLIED', message: dto.message ?? null, candidateId: null, updatedAt: new Date() })
        .where(eq(vacancyApplications.id, existing.id));
    } else {
      await this.db.insert(vacancyApplications).values({ id: uuid(), vacancyId: v.id, caregiverId, message: dto.message ?? null });
    }
    void this.notifier.toStaff(`vacancy application ${v.reference}`, {
      subject: `New application - ${v.reference}`,
      paragraphs: [`A caregiver applied for "${v.title}" (${v.reference}).`, 'Open the vacancy in the staff portal to decide whether to put them forward.'],
      cta: { label: 'Open vacancies', url: this.notifier.staffUrl('/international?tab=vacancies') },
    });
    return this.applicationsFor(caregiverId);
  }

  async withdraw(caregiverId: string, applicationId: string): Promise<CaregiverVacancyApplication[]> {
    const a = await this.application(applicationId).catch(() => null);
    if (!a || a.caregiverId !== caregiverId) throw new NotFoundException('Application not found');
    // Once staff have put them forward, stepping back goes through staff, who tell the employer.
    if (a.status !== 'APPLIED') throw new BadRequestException('This application can no longer be withdrawn here - please contact our team.');
    await this.db.update(vacancyApplications).set({ status: 'WITHDRAWN', updatedAt: new Date() }).where(eq(vacancyApplications.id, applicationId));
    return this.applicationsFor(caregiverId);
  }

  async applicationsFor(caregiverId: string): Promise<CaregiverVacancyApplication[]> {
    const rows = await this.db
      .select({ a: vacancyApplications, v: overseasVacancies, organisationType: employerEnquiries.organisationType })
      .from(vacancyApplications)
      .innerJoin(overseasVacancies, eq(vacancyApplications.vacancyId, overseasVacancies.id))
      .innerJoin(employerEnquiries, eq(overseasVacancies.enquiryId, employerEnquiries.id))
      .where(and(eq(vacancyApplications.caregiverId, caregiverId), ne(vacancyApplications.status, 'WITHDRAWN')))
      .orderBy(desc(vacancyApplications.createdAt))
      .limit(50);
    const today = todayColombo();
    return rows.map(({ a, v, organisationType }) => ({
      id: a.id,
      status: a.status,
      createdAt: iso(a.createdAt),
      vacancy: { reference: v.reference, title: v.title, country: v.country, city: v.city, organisationType, open: isVacancyOpen(v, today) },
    }));
  }

  // --- internals --------------------------------------------------------------------------------

  private openCondition(): SQL {
    return and(eq(overseasVacancies.status, 'PUBLISHED'), or(isNull(overseasVacancies.closesOn), gte(overseasVacancies.closesOn, todayColombo())))!;
  }

  private values(dto: VacancyDto) {
    return {
      title: dto.title,
      country: dto.country,
      city: dto.city ?? null,
      careSetting: dto.careSetting,
      rolesCount: dto.rolesCount,
      description: dto.description,
      requirements: dto.requirements ?? null,
      minExperienceYears: dto.minExperienceYears,
      englishLevel: dto.englishLevel,
      salaryMin: dto.salaryMin ?? null,
      salaryMax: dto.salaryMax ?? null,
      salaryCurrency: dto.salaryMin != null || dto.salaryMax != null ? (dto.salaryCurrency ?? null) : null,
      salaryPeriod: dto.salaryMin != null || dto.salaryMax != null ? (dto.salaryPeriod ?? null) : null,
      contractMonths: dto.contractMonths ?? null,
      accommodationProvided: dto.accommodationProvided ?? null,
      visaSponsorship: dto.visaSponsorship,
      startTimeframe: dto.startTimeframe ?? null,
      closesOn: dto.closesOn ?? null,
    };
  }

  private async insert(values: Omit<typeof overseasVacancies.$inferInsert, 'id' | 'reference'>): Promise<string> {
    const id = uuid();
    for (let attempt = 0; ; attempt++) {
      try {
        await this.db.insert(overseasVacancies).values({ id, reference: generateVacancyReference(), ...values });
        return id;
      } catch (err) {
        if (isDuplicate(err) && attempt < 3) continue;
        throw err;
      }
    }
  }

  private select() {
    return this.db
      .select({
        v: overseasVacancies,
        enquiryReference: employerEnquiries.reference,
        organisationName: employerEnquiries.organisationName,
        organisationType: employerEnquiries.organisationType,
        employerName: employers.organisationName,
        employerStatus: employers.status,
      })
      .from(overseasVacancies)
      .innerJoin(employerEnquiries, eq(overseasVacancies.enquiryId, employerEnquiries.id))
      .leftJoin(employers, eq(overseasVacancies.employerId, employers.id))
      .$dynamic();
  }

  private async applicationCounts(vacancyIds: string[]): Promise<Map<string, { total: number; applied: number }>> {
    const out = new Map<string, { total: number; applied: number }>();
    if (!vacancyIds.length) return out;
    const rows = await this.db
      .select({ vacancyId: vacancyApplications.vacancyId, status: vacancyApplications.status, n: count() })
      .from(vacancyApplications)
      .where(and(inArray(vacancyApplications.vacancyId, vacancyIds), ne(vacancyApplications.status, 'WITHDRAWN')))
      .groupBy(vacancyApplications.vacancyId, vacancyApplications.status);
    for (const r of rows) {
      const c = out.get(r.vacancyId) ?? { total: 0, applied: 0 };
      c.total += Number(r.n);
      if (r.status === 'APPLIED') c.applied += Number(r.n);
      out.set(r.vacancyId, c);
    }
    return out;
  }

  private async row(id: string): Promise<VacancyRow> {
    const [row] = await this.db.select().from(overseasVacancies).where(eq(overseasVacancies.id, id)).limit(1);
    if (!row) throw new NotFoundException('Vacancy not found');
    return row;
  }

  /** One of this employer's own vacancies - someone else's reads as not found. */
  private async ownVacancy(employerId: string, id: string): Promise<VacancyRow> {
    const row = await this.row(id).catch(() => null);
    if (!row || row.employerId !== employerId) throw new NotFoundException('Vacancy not found');
    return row;
  }

  private async application(id: string): Promise<ApplicationRow> {
    const [row] = await this.db.select().from(vacancyApplications).where(eq(vacancyApplications.id, id)).limit(1);
    if (!row) throw new NotFoundException('Application not found');
    return row;
  }

  private async notifyEmployerOfReview(v: VacancyRow, status: 'PUBLISHED' | 'REJECTED', note: string | null) {
    if (!v.employerId) return;
    const [row] = await this.db
      .select({ email: users.email })
      .from(employers)
      .innerJoin(users, eq(employers.userId, users.id))
      .where(eq(employers.id, v.employerId))
      .limit(1);
    const notice =
      status === 'PUBLISHED'
        ? {
            subject: `Your vacancy is live - ${v.reference}`,
            paragraphs: [`"${v.title}" is now on our vacancy board. Caregivers can apply, and our team will put forward the ones who fit.`],
          }
        : {
            subject: `Your vacancy needs changes - ${v.reference}`,
            paragraphs: [`Our team could not publish "${v.title}" as it is.`, ...(note ? [`Their note: ${note}`] : []), 'You can change it and send it again from your employer account.'],
          };
    await this.notifier.toAddress(row?.email, `vacancy review ${v.reference}`, { ...notice, cta: { label: 'Open your vacancies', url: this.notifier.publicUrl('/employer/vacancies') } });
  }

  private async notifyApplicant(caregiverId: string, v: VacancyRow, status: 'PUT_FORWARD' | 'NOT_SUCCESSFUL') {
    const [row] = await this.db
      .select({ email: users.email })
      .from(caregivers)
      .innerJoin(users, eq(caregivers.userId, users.id))
      .where(eq(caregivers.id, caregiverId))
      .limit(1);
    const notice =
      status === 'PUT_FORWARD'
        ? {
            subject: 'Your application has been put forward',
            paragraphs: [`Our team has put your shared profile forward for "${v.title}". We will contact you if the employer would like an interview.`],
          }
        : {
            subject: 'An update on your application',
            paragraphs: [`Thank you for applying for "${v.title}". This time our team has not put your profile forward. Keep your Work abroad section up to date - new vacancies are posted often.`],
          };
    await this.notifier.toAddress(row?.email, `application ${status}`, { ...notice, cta: { label: 'Open Work abroad', url: this.notifier.publicUrl('/caregiver/work-abroad') } });
  }
}

type SelectedRow = {
  v: VacancyRow;
  enquiryReference: string;
  organisationName: string;
  organisationType: (typeof employerEnquiries.$inferSelect)['organisationType'];
  employerName: string | null;
  employerStatus: (typeof employers.$inferSelect)['status'] | null;
};

function toPublicVacancy({ v, organisationType }: SelectedRow): PublicVacancy {
  return {
    reference: v.reference,
    title: v.title,
    organisationType,
    country: v.country,
    city: v.city,
    careSetting: v.careSetting,
    rolesCount: v.rolesCount,
    description: v.description,
    requirements: v.requirements,
    minExperienceYears: v.minExperienceYears,
    englishLevel: v.englishLevel,
    salaryMin: v.salaryMin,
    salaryMax: v.salaryMax,
    salaryCurrency: v.salaryCurrency,
    salaryPeriod: v.salaryPeriod,
    contractMonths: v.contractMonths,
    accommodationProvided: v.accommodationProvided,
    visaSponsorship: v.visaSponsorship,
    startTimeframe: v.startTimeframe,
    closesOn: v.closesOn,
    publishedAt: iso(v.publishedAt ?? v.createdAt),
  };
}

function toVacancy(r: SelectedRow, applicationCount: number): Vacancy {
  return {
    ...toPublicVacancy(r),
    id: r.v.id,
    enquiryId: r.v.enquiryId,
    enquiryReference: r.enquiryReference,
    status: r.v.status,
    reviewNote: r.v.reviewNote,
    publishedAt: r.v.publishedAt ? iso(r.v.publishedAt) : null,
    createdAt: iso(r.v.createdAt),
    updatedAt: iso(r.v.updatedAt),
    applicationCount,
  };
}

function toStaffVacancy(r: SelectedRow, counts?: { total: number; applied: number }): StaffVacancy {
  return {
    ...toVacancy(r, counts?.total ?? 0),
    organisationName: r.organisationName,
    employer: r.v.employerId && r.employerName && r.employerStatus ? { id: r.v.employerId, organisationName: r.employerName, status: r.employerStatus } : null,
    newApplications: counts?.applied ?? 0,
  };
}

function toStaffApplication(
  a: ApplicationRow,
  registrationNumber: string,
  fullName: string,
  profileLive: boolean,
  readiness: StaffVacancyApplication['readiness'],
): StaffVacancyApplication {
  return {
    id: a.id,
    vacancyId: a.vacancyId,
    caregiverId: a.caregiverId,
    registrationNumber,
    fullName,
    status: a.status,
    message: a.message,
    staffNote: a.staffNote,
    candidateId: a.candidateId,
    profileLive,
    readiness,
    createdAt: iso(a.createdAt),
  };
}
