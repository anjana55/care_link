import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, count, desc, eq, isNotNull, isNull } from 'drizzle-orm';
import type { EmployerAccount, EmployerAdminRow, PublicTalentCard } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { employerEnquiries, employerShortlist, employers, sharedProfiles, users } from '../database/schema';
import type { AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { EmployerQueryDto, ReviewEmployerDto, UpdateEmployerAccountDto } from './dto/international.dto';
import { SharedProfilesService } from './shared-profiles.service';
import { InternationalNotifier } from './international-notifier.service';

type EmployerRow = typeof employers.$inferSelect;

/** The employer behind a signed-in EMPLOYER login, or a 403. */
export function employerIdOf(user: AuthenticatedUser): string {
  if (user.role !== 'EMPLOYER' || !user.employerId) throw new ForbiddenException('You do not have permission to perform this action');
  return user.employerId;
}

/**
 * Overseas employers' own accounts: their organisation details, a shortlist of
 * shared profiles, and - for staff - verifying who they are.
 *
 * Verification is the gate on anything that reaches a caregiver: only a
 * verified employer can ask to interview someone. Until then an account can
 * browse the shared profiles anyone can see and save a shortlist.
 */
@Injectable()
export class EmployersService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly sharedProfiles: SharedProfilesService,
    private readonly notifier: InternationalNotifier,
  ) {}

  // --- the employer's own account ----------------------------------------------

  async me(employerId: string): Promise<EmployerAccount> {
    const [row] = await this.db
      .select({ e: employers, email: users.email })
      .from(employers)
      .innerJoin(users, eq(employers.userId, users.id))
      .where(eq(employers.id, employerId))
      .limit(1);
    if (!row) throw new NotFoundException('Employer not found');
    return toAccount(row.e, row.email);
  }

  /**
   * Contact details can always change. The organisation itself - name, type,
   * country - is what staff verified, so once verified only staff change it.
   * A rejected account can correct it, which sends it back for review.
   */
  async updateMe(employerId: string, dto: UpdateEmployerAccountDto): Promise<EmployerAccount> {
    const current = await this.row(employerId);
    const organisationChange = dto.organisationName !== undefined || dto.organisationType !== undefined || dto.country !== undefined;
    if (organisationChange && !canEditOrganisation(current)) {
      throw new BadRequestException('Your organisation has been verified. Please contact us to change its name, type or country.');
    }
    const changes: Partial<typeof employers.$inferInsert> = { updatedAt: new Date() };
    for (const key of ['organisationName', 'organisationType', 'country', 'contactName', 'phone', 'website', 'companyRegistrationNumber'] as const) {
      if (dto[key] !== undefined) (changes as Record<string, unknown>)[key] = dto[key];
    }
    if (organisationChange && current.status === 'REJECTED') {
      changes.status = 'PENDING_REVIEW';
      changes.reviewNote = null;
    }
    await this.db.update(employers).set(changes).where(eq(employers.id, employerId));
    return this.me(employerId);
  }

  /** Throws unless the employer is verified - the gate on asking for interviews. */
  async assertVerified(employerId: string): Promise<EmployerRow> {
    const row = await this.row(employerId);
    if (row.status !== 'VERIFIED') {
      throw new ForbiddenException('Your organisation must be verified by our team before you can ask for interviews.');
    }
    return row;
  }

  // --- shortlist -------------------------------------------------------------------

  /** Saved shared profiles that are still live, newest first. A paused profile drops out of view, and back in if it returns. */
  async shortlist(employerId: string, locale?: string): Promise<PublicTalentCard[]> {
    const rows = await this.db
      .select({ caregiverId: employerShortlist.caregiverId })
      .from(employerShortlist)
      .where(eq(employerShortlist.employerId, employerId))
      .orderBy(desc(employerShortlist.createdAt));
    const cards = await this.sharedProfiles.liveCards(
      rows.map((r) => r.caregiverId),
      locale,
    );
    return rows.map((r) => cards.get(r.caregiverId)).filter((c): c is PublicTalentCard => Boolean(c));
  }

  async addToShortlist(employerId: string, slug: string, locale?: string): Promise<PublicTalentCard[]> {
    const caregiverId = await this.sharedProfiles.liveCaregiverIdForSlug(slug);
    if (!caregiverId) throw new NotFoundException('Profile not found');
    await this.db.insert(employerShortlist).values({ employerId, caregiverId }).onDuplicateKeyUpdate({ set: { employerId } });
    return this.shortlist(employerId, locale);
  }

  async removeFromShortlist(employerId: string, slug: string, locale?: string): Promise<PublicTalentCard[]> {
    // By slug, whatever state the profile is in now - removing must always work.
    const [row] = await this.db
      .select({ caregiverId: employerShortlist.caregiverId })
      .from(employerShortlist)
      .innerJoin(sharedProfiles, eq(sharedProfiles.caregiverId, employerShortlist.caregiverId))
      .where(and(eq(employerShortlist.employerId, employerId), eq(sharedProfiles.slug, slug)))
      .limit(1);
    if (row) {
      await this.db.delete(employerShortlist).where(and(eq(employerShortlist.employerId, employerId), eq(employerShortlist.caregiverId, row.caregiverId)));
    }
    return this.shortlist(employerId, locale);
  }

  // --- staff -----------------------------------------------------------------------

  async adminList(query: EmployerQueryDto): Promise<EmployerAdminRow[]> {
    const status = query.status ?? 'PENDING_REVIEW';
    const enquiryCounts = this.db
      .select({ employerId: employerEnquiries.employerId, n: count().as('n') })
      .from(employerEnquiries)
      .where(isNotNull(employerEnquiries.employerId))
      .groupBy(employerEnquiries.employerId)
      .as('enquiry_counts');
    const rows = await this.db
      .select({ e: employers, email: users.email, emailVerifiedAt: users.emailVerifiedAt, enquiries: enquiryCounts.n })
      .from(employers)
      .innerJoin(users, eq(employers.userId, users.id))
      .leftJoin(enquiryCounts, eq(enquiryCounts.employerId, employers.id))
      .where(status === 'all' ? undefined : eq(employers.status, status))
      .orderBy(desc(employers.createdAt))
      .limit(300);
    return rows.map(({ e, email, emailVerifiedAt, enquiries }) => ({
      id: e.id,
      email,
      organisationName: e.organisationName,
      organisationType: e.organisationType,
      country: e.country,
      contactName: e.contactName,
      phone: e.phone,
      website: e.website,
      companyRegistrationNumber: e.companyRegistrationNumber,
      status: e.status,
      reviewNote: e.reviewNote,
      emailVerified: Boolean(emailVerifiedAt),
      enquiryCount: Number(enquiries ?? 0),
      createdAt: new Date(e.createdAt).toISOString(),
    }));
  }

  /** Accounts waiting for staff - only those whose email is confirmed, so a typo'd address never reaches the queue. */
  async pendingCount(): Promise<number> {
    const [{ n }] = await this.db
      .select({ n: count() })
      .from(employers)
      .innerJoin(users, eq(employers.userId, users.id))
      .where(and(eq(employers.status, 'PENDING_REVIEW'), isNotNull(users.emailVerifiedAt)));
    return Number(n);
  }

  async review(employerId: string, dto: ReviewEmployerDto, staffUserId: string): Promise<EmployerAdminRow> {
    const row = await this.row(employerId);
    if (dto.decision !== 'VERIFY' && !dto.note) throw new BadRequestException('Tell the employer why.');
    const status = dto.decision === 'VERIFY' ? 'VERIFIED' : dto.decision === 'REJECT' ? 'REJECTED' : 'SUSPENDED';
    await this.db
      .update(employers)
      .set({ status, reviewNote: dto.note ?? null, reviewedByUserId: staffUserId, reviewedAt: new Date(), updatedAt: new Date() })
      .where(eq(employers.id, employerId));

    const [account] = await this.db.select({ email: users.email }).from(users).where(eq(users.id, row.userId)).limit(1);
    if (status === 'VERIFIED' && account?.email) {
      // Enquiries they sent from the public form before signing up, from the same address, join their account.
      await this.db
        .update(employerEnquiries)
        .set({ employerId })
        .where(and(isNull(employerEnquiries.employerId), eq(employerEnquiries.email, account.email.toLowerCase())));
    }
    void this.notifyReviewed(account?.email ?? null, row, status, dto.note);
    return (await this.adminList({ status: 'all' })).find((e) => e.id === employerId)!;
  }

  private async notifyReviewed(email: string | null, row: EmployerRow, status: 'VERIFIED' | 'REJECTED' | 'SUSPENDED', note?: string) {
    const url = this.notifier.publicUrl('/employer');
    const notices = {
      VERIFIED: {
        subject: 'Your organisation is verified',
        paragraphs: [
          `${row.organisationName} has been verified. You can now ask to interview caregivers from their shared profiles, and see everyone our team puts forward for your enquiries.`,
        ],
      },
      REJECTED: {
        subject: 'We could not verify your organisation',
        paragraphs: [`We were not able to verify ${row.organisationName}.`, ...(note ? [`Our team says: ${note}`] : []), 'You can update your details and we will look again.'],
      },
      SUSPENDED: {
        subject: 'Your employer account has been suspended',
        paragraphs: [`The employer account for ${row.organisationName} has been suspended.`, ...(note ? [`Our team says: ${note}`] : [])],
      },
    } as const;
    await this.notifier.toAddress(email, `employer ${status.toLowerCase()}`, { ...notices[status], paragraphs: [...notices[status].paragraphs], cta: { label: 'Open your account', url } });
  }

  private async row(employerId: string): Promise<EmployerRow> {
    const [row] = await this.db.select().from(employers).where(eq(employers.id, employerId)).limit(1);
    if (!row) throw new NotFoundException('Employer not found');
    return row;
  }
}

export function canEditOrganisation(row: Pick<EmployerRow, 'status'>): boolean {
  return row.status === 'PENDING_REVIEW' || row.status === 'REJECTED';
}

function toAccount(e: EmployerRow, email: string | null): EmployerAccount {
  return {
    id: e.id,
    email,
    organisationName: e.organisationName,
    organisationType: e.organisationType,
    country: e.country,
    contactName: e.contactName,
    phone: e.phone,
    website: e.website,
    companyRegistrationNumber: e.companyRegistrationNumber,
    status: e.status,
    reviewNote: e.reviewNote,
    canEditOrganisation: canEditOrganisation(e),
  };
}
