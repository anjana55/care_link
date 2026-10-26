import { Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomInt, randomUUID as uuid } from 'crypto';
import { and, count, desc, eq, inArray, isNotNull, like, or, type SQL } from 'drizzle-orm';
import type {
  EmployerEnquiry,
  EmployerEnquiryList,
  EmployerEnquiryReceipt,
  EmployerEnquirySummary,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { caregivers, employerEnquiries, sharedProfiles, users } from '../database/schema';
import { EmailService } from '../email/email.service';
import { EmailSettingsService } from '../email/email-settings.service';
import { CreateEmployerEnquiryDto, EmployerEnquiryQueryDto, UpdateEmployerEnquiryDto } from './dto/international.dto';
import { SharedProfilesService } from './shared-profiles.service';

/** Same alphabet as care request references: nothing that reads two ways over the phone. */
const REFERENCE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTVWXYZ';

export function generateEnquiryReference(): string {
  let out = 'IE-';
  for (let i = 0; i < 6; i++) out += REFERENCE_ALPHABET[randomInt(REFERENCE_ALPHABET.length)];
  return out;
}

const OPEN_STATUSES = ['NEW', 'IN_PROGRESS', 'INTRODUCED'] as const;

const isDuplicate = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e.code ?? e.cause?.code) === 'ER_DUP_ENTRY';
};

/**
 * Enquiries from overseas employers.
 *
 * The platform has no foreign-employment recruitment licence of its own, so
 * employers never get accounts, search access or anyone's contact details:
 * they describe what they need, and staff take it from there - shortlisting,
 * introductions and, when a caregiver starts work, recording the placement
 * fee the employer pays.
 */
@Injectable()
export class EmployerEnquiriesService {
  private readonly logger = new Logger(EmployerEnquiriesService.name);

  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly sharedProfiles: SharedProfilesService,
    private readonly email: EmailService,
    private readonly emailSettings: EmailSettingsService,
    private readonly config: ConfigService,
  ) {}

  async create(dto: CreateEmployerEnquiryDto): Promise<EmployerEnquiryReceipt> {
    // A bot filled the field people never see. Look successful, store nothing.
    if (dto.website2) return { reference: generateEnquiryReference() };

    // Asked from a shared profile: attach the caregiver, but only while that
    // profile is actually live - a stale link must not reach anyone.
    const caregiverId = dto.talentSlug ? await this.sharedProfiles.liveCaregiverIdForSlug(dto.talentSlug) : null;

    const id = uuid();
    for (let attempt = 0; ; attempt++) {
      const reference = generateEnquiryReference();
      try {
        await this.db.insert(employerEnquiries).values({
          id,
          reference,
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
          consentAcceptedAt: new Date(),
          language: dto.language ?? 'en',
        });
        void this.notify(id, reference, dto, caregiverId);
        return { reference };
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
    if (query.status === 'open') conditions.push(inArray(employerEnquiries.status, [...OPEN_STATUSES]));
    else if (query.status) conditions.push(eq(employerEnquiries.status, query.status));
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
      .where(inArray(employerEnquiries.status, [...OPEN_STATUSES]))
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
      })
      .from(employerEnquiries)
      .leftJoin(caregivers, eq(employerEnquiries.caregiverId, caregivers.id))
      .leftJoin(sharedProfiles, eq(sharedProfiles.caregiverId, employerEnquiries.caregiverId))
      .$dynamic();
  }

  // --- notifications -------------------------------------------------------

  /** Staff hear about a new enquiry; the employer gets a receipt. Never fails the request. */
  private async notify(id: string, reference: string, dto: CreateEmployerEnquiryDto, caregiverId: string | null) {
    try {
      const staff = await this.staffRecipients();
      const about = caregiverId ? ' They asked about a specific caregiver from a shared profile.' : '';
      if (staff.length) {
        await this.email.sendNotificationEmail(
          staff,
          {
            subject: `New overseas employer enquiry ${reference}`,
            blocks: [
              {
                lang: 'en',
                heading: `New overseas employer enquiry ${reference}`,
                paragraphs: [
                  `${dto.organisationName} (${dto.country}) is looking for ${dto.rolesCount} caregiver${dto.rolesCount === 1 ? '' : 's'}.${about}`,
                  'Open the enquiry in the staff portal to see the details and pick it up.',
                ],
              },
            ],
            cta: { label: 'Open enquiry', url: this.staffUrl(`/international/${id}`) },
            footer: 'Sent to the request alert list in Settings > Email, or to every admin and staff account when that list is empty.',
          },
          'employer enquiry alert',
        );
      } else {
        this.logger.warn(`Employer enquiry ${reference}: no staff email address to alert - it is waiting in the Overseas enquiries queue.`);
      }
      await this.email.sendNotificationEmail(
        dto.email,
        {
          subject: `We have your enquiry - ${reference}`,
          blocks: [
            {
              lang: 'en',
              heading: `Thank you, ${dto.contactName}`,
              paragraphs: [
                `We have received your enquiry for caregivers from Sri Lanka. Your reference is ${reference}.`,
                'Our team will contact you to understand the roles in more detail and to put forward suitable caregivers. You pay a placement fee only when a caregiver you hire starts work. Caregivers are never charged a placement fee.',
              ],
            },
          ],
        },
        'employer enquiry receipt',
      );
    } catch (err) {
      this.logger.warn(`Employer enquiry ${reference}: notification failed - ${(err as Error).message}`);
    }
  }

  private staffUrl(path: string) {
    return `${(this.config.get<string>('CAREGIVER_WEB_URL') ?? 'http://localhost:3000/staff').replace(/\/+$/, '')}${path}`;
  }

  /** Same recipients as care request alerts: the configured list, else every active admin and staff account. */
  private async staffRecipients(): Promise<string[]> {
    const settings = await this.emailSettings.getResolved();
    if (settings.requestAlertsTo) {
      return settings.requestAlertsTo
        .split(',')
        .map((a) => a.trim())
        .filter(Boolean);
    }
    const rows = await this.db
      .select({ email: users.email })
      .from(users)
      .where(and(inArray(users.role, ['ADMIN', 'STAFF']), eq(users.isActive, true), isNotNull(users.email)));
    return rows.map((r) => r.email!).filter(Boolean);
  }
}

type EnquiryRow = {
  e: typeof employerEnquiries.$inferSelect;
  registrationNumber: string | null;
  fullName: string | null;
  slug: string | null;
};

function toEnquiry({ e, registrationNumber, fullName, slug }: EnquiryRow): EmployerEnquiry {
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
    status: e.status,
    staffNote: e.staffNote,
    placementFeeAmount: e.placementFeeAmount,
    placementFeeCurrency: e.placementFeeCurrency,
    language: e.language,
    createdAt: iso(e.createdAt),
    updatedAt: iso(e.updatedAt),
  };
}

const iso = (d: Date | string) => (d instanceof Date ? d.toISOString() : new Date(d).toISOString());

