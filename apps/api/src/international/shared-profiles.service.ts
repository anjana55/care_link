import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomInt, randomUUID as uuid } from 'crypto';
import { and, count, desc, eq, inArray, isNotNull, isNull, sql, type SQL } from 'drizzle-orm';
import {
  PUBLIC_CAREGIVER_STATUSES,
  SHARED_PROFILE_CONSENT_VERSION,
  isCountryCode,
  resolveLocale,
  type PublicTalentCard,
  type PublicTalentList,
  type PublicTalentProfile,
  type SharedProfileReviewItem,
  type SharedProfileSettings,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { caregiverOverseasProfiles, caregivers, sharedProfiles } from '../database/schema';
import { STORAGE_SERVICE, type StorageService } from '../storage/storage.interface';
import { PublicSearchService } from '../public-search/public-search.service';
import { TrainingService } from './training.service';
import { preparePublicPhoto } from './profile-photo';
import { ReviewSharedProfileDto, ShareProfileDto, SharedProfileQueryDto, TalentQueryDto, UpdateSharedProfileDto } from './dto/international.dto';

type Row = typeof sharedProfiles.$inferSelect;

const SLUG_ALPHABET = 'abcdefghijkmnpqrstuvwxyz23456789';
/** 12 characters from 32: about 60 bits - not guessable, still short enough to read out. */
export function generateSlug(): string {
  let out = '';
  for (let i = 0; i < 12; i++) out += SLUG_ALPHABET[randomInt(SLUG_ALPHABET.length)];
  return out;
}

/** The first word of a full name - what a shared profile starts with until the caregiver changes it. */
export function firstNameOf(fullName: string): string {
  return (fullName.trim().split(/\s+/)[0] ?? '').slice(0, 60);
}

/**
 * Everything that must hold for a shared profile to be on the public site:
 * the caregiver switched sharing on, has consent on record, staff approved
 * what it shows, and the caregiver is still listed (not draft, suspended,
 * rejected, inactive or deleted).
 */
export const isLiveProfile = (): SQL =>
  and(
    eq(sharedProfiles.isShared, true),
    eq(sharedProfiles.status, 'APPROVED'),
    isNotNull(sharedProfiles.consentAcceptedAt),
    isNull(caregivers.deletedAt),
    inArray(caregivers.status, [...PUBLIC_CAREGIVER_STATUSES]),
  )!;

/**
 * Caregivers' opt-in public profiles: a first name, a photo and a short
 * introduction alongside what anonymous search already shows, at a link the
 * caregiver controls. Anonymous search is untouched - it never shows a name
 * or a face.
 *
 * The rules, in one place:
 *  - nothing is public without the caregiver's recorded consent, their own
 *    "share" switch, and staff approval of exactly what is shown;
 *  - any change to the name, headline, introduction or photo takes the page
 *    offline until staff approve it again;
 *  - withdrawing consent switches sharing off and deletes the photo;
 *  - a new link (slug) kills every copy of the old one.
 */
@Injectable()
export class SharedProfilesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Inject(STORAGE_SERVICE) private readonly storage: StorageService,
    private readonly publicSearch: PublicSearchService,
    private readonly training: TrainingService,
  ) {}

  // --- the caregiver's own settings -----------------------------------------

  async settings(caregiverId: string): Promise<SharedProfileSettings> {
    const row = await this.row(caregiverId);
    if (!row) {
      const [cg] = await this.db.select({ fullName: caregivers.fullName }).from(caregivers).where(eq(caregivers.id, caregiverId)).limit(1);
      if (!cg) throw new NotFoundException('Caregiver not found');
      return {
        slug: null,
        isShared: false,
        firstName: firstNameOf(cg.fullName),
        headline: null,
        bio: null,
        hasPhoto: false,
        status: 'DRAFT',
        reviewNote: null,
        consentAcceptedAt: null,
        consentVersion: null,
        isLive: false,
      };
    }
    return { ...this.toSettings(row), isLive: await this.isLive(caregiverId) };
  }

  async updateContent(caregiverId: string, dto: UpdateSharedProfileDto): Promise<SharedProfileSettings> {
    const content = { firstName: dto.firstName, headline: dto.headline ?? null, bio: dto.bio ?? null };
    const row = await this.ensureRow(caregiverId);
    const changed = row.firstName !== content.firstName || row.headline !== content.headline || row.bio !== content.bio;
    if (changed) {
      await this.db
        .update(sharedProfiles)
        .set({ ...content, ...this.backToReview(row), updatedAt: new Date() })
        .where(eq(sharedProfiles.caregiverId, caregiverId));
    }
    return this.settings(caregiverId);
  }

  /** Consent given (or confirmed) and sharing switched on. Goes to staff unless already approved. */
  async share(caregiverId: string, dto: ShareProfileDto): Promise<SharedProfileSettings> {
    if (dto.consentVersion !== SHARED_PROFILE_CONSENT_VERSION) {
      throw new BadRequestException('The consent wording has changed - please read it again before sharing.');
    }
    const row = await this.ensureRow(caregiverId);
    const needsConsent = !row.consentAcceptedAt || row.consentVersion !== dto.consentVersion;
    await this.db
      .update(sharedProfiles)
      .set({
        isShared: true,
        ...(needsConsent ? { consentAcceptedAt: new Date(), consentVersion: dto.consentVersion } : {}),
        ...(row.status === 'DRAFT' || row.status === 'REJECTED' ? { status: 'PENDING_REVIEW' as const, reviewNote: null } : {}),
        updatedAt: new Date(),
      })
      .where(eq(sharedProfiles.caregiverId, caregiverId));
    return this.settings(caregiverId);
  }

  /** Paused: offline, but consent and the approved content are kept for when they switch it back on. */
  async unshare(caregiverId: string): Promise<SharedProfileSettings> {
    await this.db.update(sharedProfiles).set({ isShared: false, updatedAt: new Date() }).where(eq(sharedProfiles.caregiverId, caregiverId));
    return this.settings(caregiverId);
  }

  /** Consent withdrawn: offline, consent cleared, photo deleted, back to a draft. */
  async withdrawConsent(caregiverId: string): Promise<SharedProfileSettings> {
    const row = await this.row(caregiverId);
    if (row) {
      if (row.photoKey) await this.storage.delete(row.photoKey).catch(() => undefined);
      await this.db
        .update(sharedProfiles)
        .set({
          isShared: false,
          consentAcceptedAt: null,
          consentVersion: null,
          photoKey: null,
          photoMimeType: null,
          status: 'DRAFT',
          reviewNote: null,
          updatedAt: new Date(),
        })
        .where(eq(sharedProfiles.caregiverId, caregiverId));
    }
    return this.settings(caregiverId);
  }

  async regenerateLink(caregiverId: string): Promise<SharedProfileSettings> {
    await this.ensureRow(caregiverId);
    for (let attempt = 0; ; attempt++) {
      try {
        await this.db.update(sharedProfiles).set({ slug: generateSlug(), updatedAt: new Date() }).where(eq(sharedProfiles.caregiverId, caregiverId));
        break;
      } catch (err) {
        if (attempt < 3 && isDuplicate(err)) continue;
        throw err;
      }
    }
    return this.settings(caregiverId);
  }

  async uploadPhoto(caregiverId: string, file: Express.Multer.File | undefined): Promise<SharedProfileSettings> {
    if (!file) throw new BadRequestException('Choose a photo to upload.');
    const photo = await preparePublicPhoto(file);
    const row = await this.ensureRow(caregiverId);
    const key = `shared-profiles/${caregiverId}/${uuid()}.webp`;
    await this.storage.upload({ key, buffer: photo.buffer, mimeType: photo.mimeType });
    await this.db
      .update(sharedProfiles)
      .set({ photoKey: key, photoMimeType: photo.mimeType, ...this.backToReview(row), updatedAt: new Date() })
      .where(eq(sharedProfiles.caregiverId, caregiverId));
    if (row.photoKey) await this.storage.delete(row.photoKey).catch(() => undefined);
    return this.settings(caregiverId);
  }

  /** Removing the photo shows less than staff approved, so it does not need another review. */
  async deletePhoto(caregiverId: string): Promise<SharedProfileSettings> {
    const row = await this.row(caregiverId);
    if (row?.photoKey) {
      await this.db.update(sharedProfiles).set({ photoKey: null, photoMimeType: null, updatedAt: new Date() }).where(eq(sharedProfiles.caregiverId, caregiverId));
      await this.storage.delete(row.photoKey).catch(() => undefined);
    }
    return this.settings(caregiverId);
  }

  /** The photo for the caregiver themselves or staff - shown whether or not the page is live. */
  async photo(caregiverId: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const row = await this.row(caregiverId);
    if (!row?.photoKey) throw new NotFoundException('No photo');
    return { buffer: await this.storage.download(row.photoKey), mimeType: row.photoMimeType ?? 'image/webp' };
  }

  // --- staff review -----------------------------------------------------------

  async reviewQueue(query: SharedProfileQueryDto): Promise<SharedProfileReviewItem[]> {
    const status = query.status ?? 'PENDING_REVIEW';
    const rows = await this.db
      .select({ p: sharedProfiles, registrationNumber: caregivers.registrationNumber, fullName: caregivers.fullName })
      .from(sharedProfiles)
      .innerJoin(caregivers, eq(sharedProfiles.caregiverId, caregivers.id))
      .where(and(isNull(caregivers.deletedAt), status === 'all' ? sql`${sharedProfiles.status} <> 'DRAFT'` : eq(sharedProfiles.status, status)))
      .orderBy(desc(sharedProfiles.updatedAt))
      .limit(200);
    return rows.map(({ p, registrationNumber, fullName }) => ({
      caregiverId: p.caregiverId,
      registrationNumber,
      fullName,
      slug: p.slug,
      firstName: p.firstName,
      headline: p.headline,
      bio: p.bio,
      hasPhoto: Boolean(p.photoKey),
      status: p.status,
      isShared: p.isShared,
      reviewNote: p.reviewNote,
      consentAcceptedAt: p.consentAcceptedAt ? new Date(p.consentAcceptedAt).toISOString() : null,
      updatedAt: new Date(p.updatedAt).toISOString(),
    }));
  }

  async pendingCount(): Promise<number> {
    const [{ n }] = await this.db.select({ n: count() }).from(sharedProfiles).where(eq(sharedProfiles.status, 'PENDING_REVIEW'));
    return Number(n);
  }

  async review(caregiverId: string, dto: ReviewSharedProfileDto, userId: string): Promise<SharedProfileReviewItem> {
    const row = await this.row(caregiverId);
    if (!row) throw new NotFoundException('Shared profile not found');
    if (row.status !== 'PENDING_REVIEW' && row.status !== 'APPROVED') {
      throw new BadRequestException('Only a profile waiting for review (or a live one being taken down) can be reviewed.');
    }
    if (dto.decision === 'APPROVE' && !row.consentAcceptedAt) throw new BadRequestException('The caregiver has not given consent.');
    if (dto.decision === 'REJECT' && !dto.note) throw new BadRequestException('Tell the caregiver what to change.');
    await this.db
      .update(sharedProfiles)
      .set({
        status: dto.decision === 'APPROVE' ? 'APPROVED' : 'REJECTED',
        reviewNote: dto.note ?? null,
        reviewedByUserId: userId,
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(sharedProfiles.caregiverId, caregiverId));
    const items = await this.reviewQueue({ status: 'all' });
    return items.find((i) => i.caregiverId === caregiverId)!;
  }

  // --- public -----------------------------------------------------------------

  async liveCaregiverIdForSlug(slug: string): Promise<string | null> {
    const [row] = await this.db
      .select({ caregiverId: sharedProfiles.caregiverId })
      .from(sharedProfiles)
      .innerJoin(caregivers, eq(sharedProfiles.caregiverId, caregivers.id))
      .where(and(eq(sharedProfiles.slug, slug), isLiveProfile()))
      .limit(1);
    return row?.caregiverId ?? null;
  }

  async publicProfile(slug: string, localeParam?: string): Promise<PublicTalentProfile> {
    const locale = resolveLocale(localeParam);
    const [row] = await this.db
      .select({ p: sharedProfiles, overseas: caregiverOverseasProfiles })
      .from(sharedProfiles)
      .innerJoin(caregivers, eq(sharedProfiles.caregiverId, caregivers.id))
      .leftJoin(caregiverOverseasProfiles, eq(caregiverOverseasProfiles.caregiverId, sharedProfiles.caregiverId))
      .where(and(eq(sharedProfiles.slug, slug), isLiveProfile()))
      .limit(1);
    if (!row) throw new NotFoundException('Profile not found');
    const [profiles, completed] = await Promise.all([
      this.publicSearch.profilesFor([row.p.caregiverId], locale),
      this.training.completedTitles([row.p.caregiverId], locale),
    ]);
    const base = profiles.get(row.p.caregiverId);
    if (!base) throw new NotFoundException('Profile not found');
    const overseas = row.overseas?.openToOverseas ? row.overseas : null;
    return {
      slug: row.p.slug,
      firstName: row.p.firstName,
      headline: row.p.headline,
      bio: row.p.bio,
      photoUrl: row.p.photoKey ? photoUrl(row.p) : null,
      approxAge: base.approxAge,
      yearsExperience: base.yearsExperience,
      verified: base.verified,
      hasVerifiedQualification: base.hasVerifiedQualification,
      careTypes: base.careTypes,
      languages: base.languages.map((l) => ({ name: l.name, proficiency: l.proficiency ?? null })),
      skills: base.skills.map((s) => s.name),
      qualifications: base.qualificationSummary,
      completedTraining: completed.get(row.p.caregiverId) ?? [],
      targetCountries: (overseas?.targetCountries ?? []).filter(isCountryCode),
      availableFrom: overseas?.availableFrom ?? null,
    };
  }

  /** The photo on a live profile - nothing at all otherwise, so a paused or rejected profile's photo is not reachable. */
  async publicPhoto(slug: string): Promise<{ buffer: Buffer; mimeType: string }> {
    const [row] = await this.db
      .select({ photoKey: sharedProfiles.photoKey, mimeType: sharedProfiles.photoMimeType })
      .from(sharedProfiles)
      .innerJoin(caregivers, eq(sharedProfiles.caregiverId, caregivers.id))
      .where(and(eq(sharedProfiles.slug, slug), isLiveProfile()))
      .limit(1);
    if (!row?.photoKey) throw new NotFoundException('No photo');
    return { buffer: await this.storage.download(row.photoKey), mimeType: row.mimeType ?? 'image/webp' };
  }

  /**
   * The talent directory on the employer page: live shared profiles of
   * caregivers who are open to working abroad, newest approval first.
   */
  async directory(query: TalentQueryDto): Promise<PublicTalentList> {
    const locale = resolveLocale(query.locale);
    const page = query.page ?? 1;
    const pageSize = query.pageSize ?? 12;
    const where = and(
      isLiveProfile(),
      eq(caregiverOverseasProfiles.openToOverseas, true),
      query.country ? sql`JSON_CONTAINS(${caregiverOverseasProfiles.targetCountries}, ${JSON.stringify(query.country)})` : undefined,
    );
    const base = () =>
      this.db
        .select({ p: sharedProfiles, overseas: caregiverOverseasProfiles })
        .from(sharedProfiles)
        .innerJoin(caregivers, eq(sharedProfiles.caregiverId, caregivers.id))
        .innerJoin(caregiverOverseasProfiles, eq(caregiverOverseasProfiles.caregiverId, sharedProfiles.caregiverId));
    const [rows, [{ total }]] = await Promise.all([
      base()
        .where(where)
        .orderBy(desc(sharedProfiles.reviewedAt))
        .limit(pageSize)
        .offset((page - 1) * pageSize),
      this.db
        .select({ total: count() })
        .from(sharedProfiles)
        .innerJoin(caregivers, eq(sharedProfiles.caregiverId, caregivers.id))
        .innerJoin(caregiverOverseasProfiles, eq(caregiverOverseasProfiles.caregiverId, sharedProfiles.caregiverId))
        .where(where),
    ]);
    const ids = rows.map((r) => r.p.caregiverId);
    const [profiles, completed] = await Promise.all([this.publicSearch.profilesFor(ids, locale), this.training.completedTitles(ids, locale)]);
    const items: PublicTalentCard[] = [];
    for (const { p, overseas } of rows) {
      const profile = profiles.get(p.caregiverId);
      if (!profile) continue;
      items.push({
        slug: p.slug,
        firstName: p.firstName,
        headline: p.headline,
        photoUrl: p.photoKey ? photoUrl(p) : null,
        yearsExperience: profile.yearsExperience,
        verified: profile.verified,
        languages: profile.languages.map((l) => ({ name: l.name, proficiency: l.proficiency ?? null })),
        completedTraining: completed.get(p.caregiverId) ?? [],
        targetCountries: (overseas.targetCountries ?? []).filter(isCountryCode),
      });
    }
    return { items, page, pageSize, total: Number(total) };
  }

  /** Listed caregivers open to working abroad, and how many of them have a live shared profile. */
  async openToOverseasCounts(): Promise<{ openToOverseas: number; sharedProfiles: number }> {
    const listed = and(isNull(caregivers.deletedAt), inArray(caregivers.status, [...PUBLIC_CAREGIVER_STATUSES]));
    const [[open], [shared]] = await Promise.all([
      this.db
        .select({ n: count() })
        .from(caregiverOverseasProfiles)
        .innerJoin(caregivers, eq(caregiverOverseasProfiles.caregiverId, caregivers.id))
        .where(and(listed, eq(caregiverOverseasProfiles.openToOverseas, true))),
      this.db
        .select({ n: count() })
        .from(sharedProfiles)
        .innerJoin(caregivers, eq(sharedProfiles.caregiverId, caregivers.id))
        .innerJoin(caregiverOverseasProfiles, eq(caregiverOverseasProfiles.caregiverId, sharedProfiles.caregiverId))
        .where(and(isLiveProfile(), eq(caregiverOverseasProfiles.openToOverseas, true))),
    ]);
    return { openToOverseas: Number(open.n), sharedProfiles: Number(shared.n) };
  }

  // --- internals --------------------------------------------------------------

  private async row(caregiverId: string): Promise<Row | null> {
    const [row] = await this.db.select().from(sharedProfiles).where(eq(sharedProfiles.caregiverId, caregiverId)).limit(1);
    return row ?? null;
  }

  private async ensureRow(caregiverId: string): Promise<Row> {
    const existing = await this.row(caregiverId);
    if (existing) return existing;
    const [cg] = await this.db.select({ fullName: caregivers.fullName }).from(caregivers).where(eq(caregivers.id, caregiverId)).limit(1);
    if (!cg) throw new NotFoundException('Caregiver not found');
    await this.db.insert(sharedProfiles).values({ caregiverId, slug: generateSlug(), firstName: firstNameOf(cg.fullName) || '-' });
    return (await this.row(caregiverId))!;
  }

  /** Content changed: anything staff have already seen goes back to them, and is offline meanwhile. */
  private backToReview(row: Row) {
    return row.status === 'DRAFT' ? {} : { status: 'PENDING_REVIEW' as const, reviewNote: null };
  }

  private async isLive(caregiverId: string): Promise<boolean> {
    const [row] = await this.db
      .select({ id: sharedProfiles.caregiverId })
      .from(sharedProfiles)
      .innerJoin(caregivers, eq(sharedProfiles.caregiverId, caregivers.id))
      .where(and(eq(sharedProfiles.caregiverId, caregiverId), isLiveProfile()))
      .limit(1);
    return Boolean(row);
  }

  private toSettings(row: Row): Omit<SharedProfileSettings, 'isLive'> {
    return {
      slug: row.slug,
      isShared: row.isShared,
      firstName: row.firstName,
      headline: row.headline,
      bio: row.bio,
      hasPhoto: Boolean(row.photoKey),
      status: row.status,
      reviewNote: row.reviewNote,
      consentAcceptedAt: row.consentAcceptedAt ? new Date(row.consentAcceptedAt).toISOString() : null,
      consentVersion: row.consentVersion,
    };
  }
}

/** Versioned by the stored key, so a new photo is never served from a cache of the old one. */
function photoUrl(row: Pick<Row, 'slug' | 'photoKey'>): string {
  const version = (row.photoKey ?? '').split('/').pop()?.slice(0, 8) ?? '';
  return `/public/talent/${row.slug}/photo?v=${version}`;
}

const isDuplicate = (err: unknown) => {
  const e = err as { code?: string; cause?: { code?: string } };
  return (e.code ?? e.cause?.code) === 'ER_DUP_ENTRY';
};
