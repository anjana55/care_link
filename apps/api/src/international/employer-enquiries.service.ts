import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt, randomUUID as uuid } from 'crypto';
import { and, count, desc, eq, inArray, like, or, type SQL } from 'drizzle-orm';
import type { EmployerEnquiry, EmployerEnquiryList, EmployerEnquiryReceipt, EmployerEnquirySummary } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { caregivers, employerEnquiries, employers, sharedProfiles, users } from '../database/schema';
import { CreateEmployerEnquiryDto, EmployerAccountEnquiryDto, EmployerEnquiryQueryDto, UpdateEmployerEnquiryDto } from './dto/international.dto';
import { SharedProfilesService } from './shared-profiles.service';
import { InternationalNotifier } from './international-notifier.service';

/** Same alphabet as care request references: nothing that reads two ways over the phone. */
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateEnquiryReference(): string {
  let out = 'IE-';
  for (let i = 0; i < 6; i++) out += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return out;
}

/** Staff-facing note on the enquiry behind a vacancy. */
const vacancyNote = (title: string) => ['Posted as a vacancy', title].join(': ');

export const OPEN_ENQUIRY_STATUSES = ['NEW', 'IN_PROGRESS', 'INTRODUCED'] as const;

const isDuplicate = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e.code ?? e.cause?.code) === 'ER_DUP_ENTRY';
};

type EnquiryValues = Omit<typeof employerEnquiries.$inferInsert, 'id' | 'reference' | 'consentAcceptedAt'>;

/**
 * Enquiries from overseas employers - sent from the public form, or by a
 * signed-in employer account.
 *
 * The platform has no foreign-employment recruitment licence of its own, so
 * staff make every introduction: employers never get anyone's contact
 * details. When a caregiver starts work, staff record the placement fee the
 * employer pays.
 */
@Injectable()
export class EmployerEnquiriesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly sharedProfiles: SharedProfilesService,
    private readonly notifier: InternationalNotifier,
  ) {}

  /** The public form. */
  async create(dto: CreateEmployerEnquiryDto): Promise<EmployerEnquiryReceipt> {
    // A bot filled the field people never see. Look successful, store nothing.
    if (dto.website2) return { reference: generateEnquiryReference() };
    // Asked from a shared profile: attach the caregiver, but only while that
    // profile is actually live - a stale link must not reach anyone.
    const caregiverId = dto.talentSlug ? await this.sharedProfiles.liveCaregiverIdForSlug(dto.talentSlug) : null;
    const { reference } = await this.insert({
      organisationName: dto.organisationName,
      organisationType: dto.organisationType,
      country: dto.country,
      contactName: dto.contactName,
      email: dto.email.toLowerCase(),
      phone: dto.phone ?? null,
      website: dto.website ?? null,
      rolesCount: dto.rolesCount,
      careSettings: [...new Set(dto.careSettings)],
      languages: dto.languages ?? null,
      startTimeframe: dto.startTimeframe ?? null,
      visaSponsorship: dto.visaSponsorship,
      message: dto.message ?? null,
      caregiverId,
      employerId: null,
      language: dto.language ?? 'en',
    });
    return { reference };
  }

  /** A signed-in employer's enquiry: the organisation details come from their account. */
  async createForEmployer(employerId: string, dto: EmployerAccountEnquiryDto): Promise<EmployerEnquiryReceipt> {
    const [account] = await this.db
      .select({ e: employers, email: users.email })
      .from(employers)
      .innerJoin(users, eq(employers.userId, users.id))
      .where(eq(employers.id, employerId))
      .limit(1);
    if (!account) throw new NotFoundException('Employer not found');
    const caregiverId = dto.talentSlug ? await this.sharedProfiles.liveCaregiverIdForSlug(dto.talentSlug) : null;
    const { reference } = await this.insert({
      organisationName: account.e.organisationName,
      organisationType: account.e.organisationType,
      country: dto.country ?? account.e.country,
      contactName: account.e.contactName,
      email: (account.email ?? '').toLowerCase(),
      phone: account.e.phone,
      website: account.e.website,
      rolesCount: dto.rolesCount,
      careSettings: [...new Set(dto.careSettings)],
      languages: dto.languages ?? null,
      startTimeframe: dto.startTimeframe ?? null,
      visaSponsorship: dto.visaSponsorship,
      message: dto.message ?? null,
      caregiverId,
      employerId,
      language: 'en',
    });
    return { reference };
  }

  /**
   * The enquiry behind a vacancy an employer posts: applicants staff put
   * forward become its candidates. No emails - the vacancy sends its own.
   */
  async createForVacancy(employerId: string, v: { country: string; rolesCount: number; careSetting: string; visaSponsorship: EnquiryValues['visaSponsorship']; startTimeframe: string | null; title: string }): Promise<{ id: string; reference: string }> {
    const [account] = await this.db
      .select({ e: employers, email: users.email })
      .from(employers)
      .innerJoin(users, eq(employers.userId, users.id))
      .where(eq(employers.id, employerId))
      .limit(1);
    if (!account) throw new NotFoundException('Employer not found');
    return this.insert(
      {
        organisationName: account.e.organisationName,
        organisationType: account.e.organisationType,
        country: v.country,
        contactName: account.e.contactName,
        email: (account.email ?? '').toLowerCase(),
        phone: account.e.phone,
        website: account.e.website,
        rolesCount: v.rolesCount,
        careSettings: [v.careSetting],
        languages: null,
        startTimeframe: v.startTimeframe,
        visaSponsorship: v.visaSponsorship,
        message: vacancyNote(v.title),
        caregiverId: null,
        employerId,
        language: 'en',
      },
      { notify: false },
    );
  }

  private async insert(values: EnquiryValues, { notify = true } = {}): Promise<{ id: string; reference: string }> {
    const id = uuid();
    for (let attempt = 0; ; attempt++) {
      const reference = generateEnquiryReference();
      try {
        await this.db.insert(employerEnquiries).values({ id, reference, ...values, consentAcceptedAt: new Date() });
        if (notify) void this.notifyCreated(id, reference, values);
        return { id, reference };
      } catch (err) {
        // A reference collision (1 in ~700 million) - draw again.
        if (isDuplicate(err) && attempt < 3) continue;
        throw err;
      }
    }
  }

  async findAll(query: EmployerEnquiryQueryDto): Promise<EmployerEnquiryList> {
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 25;
    const conditions: (SQL | undefined)[] = [];
    if (query.status === 'open') conditions.push(inArray(employerEnquiries.status, [...OPEN_ENQUIRY_STATUSES]));
    else if (query.status) conditions.push(eq(employerEnquiries.status, query.status));
    if (query.employerId) conditions.push(eq(employerEnquiries.employerId, query.employerId));
    if (query.search) {
      const term = `%${query.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
      conditions.push(
        or(
          like(employerEnquiries.reference, term),
          like(employerEnquiries.organisationName, term),
          like(employerEnquiries.contactName, term),
          like(employerEnquiries.email, term),
        ),
      );
    }
    const where = conditions.length ? and(...conditions) : undefined;

    const [rows, [{ total }]] = await Promise.all([
      this.selectEnquiries()
        .where(where)
        .orderBy(desc(employerEnquiries.createdAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db.select({ total: count() }).from(employerEnquiries).where(where),
    ]);
    return { items: rows.map(toEnquiry), page, pageSize, total: Number(total) };
  }

  async findOne(id: string): Promise<EmployerEnquiry> {
    const [row] = await this.selectEnquiries().where(eq(employerEnquiries.id, id)).limit(1);
    if (!row) throw new NotFoundException('Enquiry not found');
    return toEnquiry(row);
  }

  async update(id: string, dto: UpdateEmployerEnquiryDto, userId: string): Promise<EmployerEnquiry> {
    await this.findOne(id);
    const changes: Partial<typeof employerEnquiries.$inferInsert> = { updatedAt: new Date() };
    if (dto.status !== undefined) changes.status = dto.status;
    if (dto.staffNote !== undefined) changes.staffNote = dto.staffNote;
    if (dto.placementFeeAmount !== undefined) changes.placementFeeAmount = dto.placementFeeAmount;
    if (dto.placementFeeCurrency !== undefined) changes.placementFeeCurrency = dto.placementFeeCurrency;
    // Whoever moves it on is the one handling it.
    if (dto.status && dto.status !== 'NEW') changes.assignedToUserId = userId;
    await this.db.update(employerEnquiries).set(changes).where(eq(employerEnquiries.id, id));
    return this.findOne(id);
  }

  async summary(): Promise<EmployerEnquirySummary> {
    const rows = await this.db
      .select({ status: employerEnquiries.status, n: count() })
      .from(employerEnquiries)
      .where(inArray(employerEnquiries.status, [...OPEN_ENQUIRY_STATUSES]))
      .groupBy(employerEnquiries.status);
    const by = new Map(rows.map((r) => [r.status, Number(r.n)]));
    return { new: by.get('NEW') ?? 0, open: rows.reduce((s, r) => s + Number(r.n), 0) };
  }

  private selectEnquiries() {
    return this.db
      .select({
        e: employerEnquiries,
        registrationNumber: caregivers.registrationNumber,
        fullName: caregivers.fullName,
        slug: sharedProfiles.slug,
        employerName: employers.organisationName,
        employerStatus: employers.status,
      })
      .from(employerEnquiries)
      .leftJoin(caregivers, eq(employerEnquiries.caregiverId, caregivers.id))
      .leftJoin(sharedProfiles, eq(sharedProfiles.caregiverId, employerEnquiries.caregiverId))
      .leftJoin(employers, eq(employerEnquiries.employerId, employers.id))
      .$dynamic();
  }

  /** Staff hear about a new enquiry; the employer gets a receipt. Never fails the request. */
  private async notifyCreated(id: string, reference: string, v: EnquiryValues) {
    const about = v.caregiverId ? ' They asked about a specific caregiver from a shared profile.' : '';
    const account = v.employerId ? ' Sent from their employer account.' : '';
    await this.notifier.toStaff(`employer enquiry ${reference}`, {
      subject: `New overseas employer enquiry ${reference}`,
      paragraphs: [
        `${v.organisationName} (${v.country}) is looking for ${v.rolesCount} caregiver${v.rolesCount === 1 ? '' : 's'}.${about}${account}`,
        'Open the enquiry in the staff portal to see the details and pick it up.',
      ],
      cta: { label: 'Open enquiry', url: this.notifier.staffUrl(`/international/${id}`) },
    });
    await this.notifier.toAddress(v.email, `employer enquiry receipt ${reference}`, {
      subject: `We have your enquiry - ${reference}`,
      heading: `Thank you, ${v.contactName}`,
      paragraphs: [
        `We have received your enquiry for caregivers from Sri Lanka. Your reference is ${reference}.`,
        'Our team will contact you to understand the roles in more detail and to put forward suitable caregivers. You pay a placement fee only when a caregiver you hire starts work. Caregivers are never charged a placement fee.',
      ],
    });
  }
}

type EnquiryRow = {
  e: typeof employerEnquiries.$inferSelect;
  registrationNumber: string | null;
  fullName: string | null;
  slug: string | null;
  employerName: string | null;
  employerStatus: (typeof employers.$inferSelect)['status'] | null;
};

function toEnquiry({ e, registrationNumber, fullName, slug, employerName, employerStatus }: EnquiryRow): EmployerEnquiry {
  return {
    id: e.id,
    reference: e.reference,
    organisationName: e.organisationName,
    organisationType: e.organisationType,
    country: e.country,
    contactName: e.contactName,
    email: e.email,
    phone: e.phone,
    website: e.website,
    rolesCount: e.rolesCount,
    careSettings: e.careSettings ?? [],
    languages: e.languages,
    startTimeframe: e.startTimeframe,
    visaSponsorship: e.visaSponsorship,
    message: e.message,
    caregiver:
      e.caregiverId && registrationNumber
        ? { id: e.caregiverId, registrationNumber, fullName: fullName ?? '', talentSlug: slug }
        : null,
    employer: e.employerId && employerName && employerStatus ? { id: e.employerId, organisationName: employerName, status: employerStatus } : null,
    status: e.status,
    staffNote: e.staffNote,
    placementFeeAmount: e.placementFeeAmount,
    placementFeeCurrency: e.placementFeeCurrency,
    language: e.language,
    createdAt: iso(e.createdAt),
    updatedAt: iso(e.updatedAt),
  };
}

export const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());
