import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, like, or, sql } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  caregivers,
  caregiverSkills,
  skills,
  caregiverLanguages,
  languages,
  preferredLocations,
  cities,
  availability,
  caregiverDocuments,
  CAREGIVER_STATUS_TRANSITIONS,
  type CaregiverStatus,
} from '../database/schema';
import { CreateCaregiverDto } from './dto/create-caregiver.dto';
import { UpdateCaregiverDto } from './dto/update-caregiver.dto';
import { CaregiverQueryDto } from './dto/caregiver-query.dto';
import { maskIdentifier, maskPhone } from '../common/utils/masking.util';
import { generateRegistrationNumber, assertUniqueContactFields, resolveLocationRefs } from './caregiver-creation.util';

/** A condition that always evaluates to false - used to short-circuit a
 * filter to "no results" without ever building an invalid `IN ()` clause. */
const NONE = sql`1 = 0`;

/**
 * The columns a client may write directly on a caregiver. Everything else -
 * status, registrationNumber, publicId, userId, the derived location columns,
 * the timestamps - is either set at creation or owned by a dedicated endpoint.
 * An explicit list, because the DTO-to-row spread this replaces would have
 * written whatever a client sent.
 */
const UPDATABLE_COLUMNS: ReadonlySet<string> = new Set([
  'fullName',
  'permanentAddress',
  'nic',
  'passportNumber',
  'dateOfBirth',
  'gender',
  'civilStatus',
  'heightIn',
  'weightKg',
  'primaryPhone',
  'secondaryPhone',
  'emergencyContactName',
  'emergencyContactNumber',
  'emergencyContactRelationship',
  'policeDivision',
  'policeStation',
]);

@Injectable()
export class CaregiversService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}


  async create(dto: CreateCaregiverDto) {
    await assertUniqueContactFields(this.db, dto);
    const location = await resolveLocationRefs(this.db, dto);
    const id = uuid();
    // Generated at creation time, independent of `id`, so the public-search
    // API never has to expose (or derive from) the internal primary key.
    const publicId = uuid();
    const registrationNumber = await generateRegistrationNumber(this.db);

    await this.db.insert(caregivers).values({
      id,
      publicId,
      registrationNumber,
      fullName: dto.fullName,
      permanentAddress: dto.permanentAddress,
      nic: dto.nic ?? null,
      passportNumber: dto.passportNumber ?? null,
      dateOfBirth: dto.dateOfBirth as unknown as Date,
      gender: dto.gender,
      civilStatus: dto.civilStatus,
      heightIn: dto.heightIn ?? null,
      weightKg: dto.weightKg ?? null,
      primaryPhone: dto.primaryPhone,
      secondaryPhone: dto.secondaryPhone ?? null,
      emergencyContactName: dto.emergencyContactName,
      emergencyContactNumber: dto.emergencyContactNumber,
      emergencyContactRelationship: dto.emergencyContactRelationship,
      policeDivision: dto.policeDivision ?? null,
      policeStation: dto.policeStation ?? null,
      districtId: location?.districtId ?? null,
      cityId: location?.cityId ?? null,
      district: location?.district ?? null,
      city: location?.city ?? null,
      postalCode: location?.postalCode ?? null,
      status: 'DRAFT',
    });

    return this.findOne(id);
  }

  /** Caregiver IDs that have ALL of the given skill IDs assigned. */
  private async caregiverIdsWithAllSkills(skillIds: string[]): Promise<string[]> {
    if (!skillIds.length) return [];
    const rows = await this.db
      .select({ caregiverId: caregiverSkills.caregiverId })
      .from(caregiverSkills)
      .where(inArray(caregiverSkills.skillId, skillIds))
      .groupBy(caregiverSkills.caregiverId)
      .having(sql`count(distinct ${caregiverSkills.skillId}) = ${skillIds.length}`);
    return rows.map((r) => r.caregiverId);
  }

  /** Caregiver IDs that speak ALL of the given language IDs. */
  private async caregiverIdsWithAllLanguages(languageIds: string[]): Promise<string[]> {
    if (!languageIds.length) return [];
    const rows = await this.db
      .select({ caregiverId: caregiverLanguages.caregiverId })
      .from(caregiverLanguages)
      .where(inArray(caregiverLanguages.languageId, languageIds))
      .groupBy(caregiverLanguages.caregiverId)
      .having(sql`count(distinct ${caregiverLanguages.languageId}) = ${languageIds.length}`);
    return rows.map((r) => r.caregiverId);
  }

  /** Caregiver IDs that prefer ANY of the given city IDs. */
  private async caregiverIdsWithAnyLocation(cityIds: number[]): Promise<string[]> {
    if (!cityIds.length) return [];
    const rows = await this.db
      .selectDistinct({ caregiverId: preferredLocations.caregiverId })
      .from(preferredLocations)
      .where(inArray(preferredLocations.cityId, cityIds));
    return rows.map((r) => r.caregiverId);
  }

  /** Caregiver IDs whose availability record matches ANY of the requested shift flags. */
  private async caregiverIdsWithAvailability(flags: {
    dayDuty?: boolean;
    nightDuty?: boolean;
    liveIn24h?: boolean;
  }): Promise<string[]> {
    const activeConditions = [
      flags.dayDuty ? eq(availability.dayDuty, true) : null,
      flags.nightDuty ? eq(availability.nightDuty, true) : null,
      flags.liveIn24h ? eq(availability.liveIn24h, true) : null,
    ].filter((c): c is NonNullable<typeof c> => c !== null);

    if (!activeConditions.length) return [];
    const rows = await this.db
      .selectDistinct({ caregiverId: availability.caregiverId })
      .from(availability)
      .where(or(...activeConditions));
    return rows.map((r) => r.caregiverId);
  }

  async findAll(query: CaregiverQueryDto) {
    const conditions = [isNull(caregivers.deletedAt)];

    if (query.search) {
      const term = `%${query.search}%`;
      conditions.push(
        or(like(caregivers.fullName, term), like(caregivers.registrationNumber, term), like(caregivers.primaryPhone, term))!,
      );
    }
    if (query.status) {
      conditions.push(eq(caregivers.status, query.status));
    }
    if (query.gender) {
      conditions.push(eq(caregivers.gender, query.gender));
    }

    // Advanced filters (skills/languages/location/availability) resolve to a
    // set of matching caregiver IDs first, then narrow the main query with
    // `id IN (...)`. This keeps the AND-across-facets / OR-within-a-facet
    // semantics explicit and avoids fan-out from joining multiple 1-to-many
    // tables directly onto the caregivers query.
    const [skillMatches, languageMatches, locationMatches, availabilityMatches] = await Promise.all([
      query.skillIds?.length ? this.caregiverIdsWithAllSkills(query.skillIds) : Promise.resolve(null),
      query.languageIds?.length ? this.caregiverIdsWithAllLanguages(query.languageIds) : Promise.resolve(null),
      query.locationIds?.length ? this.caregiverIdsWithAnyLocation(query.locationIds) : Promise.resolve(null),
      query.dayDuty || query.nightDuty || query.liveIn24h
        ? this.caregiverIdsWithAvailability({ dayDuty: query.dayDuty, nightDuty: query.nightDuty, liveIn24h: query.liveIn24h })
        : Promise.resolve(null),
    ]);

    for (const matches of [skillMatches, languageMatches, locationMatches, availabilityMatches]) {
      if (matches !== null) {
        conditions.push(matches.length ? inArray(caregivers.id, matches) : NONE);
      }
    }

    const whereClause = and(...conditions);

    const sortColumn = {
      fullName: caregivers.fullName,
      createdAt: caregivers.createdAt,
      registrationNumber: caregivers.registrationNumber,
      status: caregivers.status,
    }[query.sortBy];
    const orderFn = query.sortDir === 'asc' ? asc : desc;

    const [rows, [{ total }]] = await Promise.all([
      this.db
        .select()
        .from(caregivers)
        .where(whereClause)
        .orderBy(orderFn(sortColumn))
        .limit(query.pageSize)
        .offset((query.page - 1) * query.pageSize),
      this.db.select({ total: sql<number>`count(*)` }).from(caregivers).where(whereClause),
    ]);

    const caregiverIds = rows.map((r) => r.id);
    const [skillRows, languageRows, locationRows] = await Promise.all([
      caregiverIds.length
        ? this.db
            .select({ caregiverId: caregiverSkills.caregiverId, skillName: skills.name })
            .from(caregiverSkills)
            .innerJoin(skills, eq(caregiverSkills.skillId, skills.id))
            .where(sql`${caregiverSkills.caregiverId} in ${caregiverIds}`)
        : Promise.resolve([] as { caregiverId: string; skillName: string }[]),
      caregiverIds.length
        ? this.db
            .select({ caregiverId: caregiverLanguages.caregiverId, languageName: languages.name })
            .from(caregiverLanguages)
            .innerJoin(languages, eq(caregiverLanguages.languageId, languages.id))
            .where(sql`${caregiverLanguages.caregiverId} in ${caregiverIds}`)
        : Promise.resolve([] as { caregiverId: string; languageName: string }[]),
      caregiverIds.length
        ? this.db
            .select({ caregiverId: preferredLocations.caregiverId, city: cities.nameEn })
            .from(preferredLocations)
            .innerJoin(cities, eq(preferredLocations.cityId, cities.id))
            .where(sql`${preferredLocations.caregiverId} in ${caregiverIds}`)
        : Promise.resolve([] as { caregiverId: string; city: string }[]),
    ]);

    const items = rows.map((row) => ({
      ...row,
      nic: maskIdentifier(row.nic),
      passportNumber: maskIdentifier(row.passportNumber),
      primaryPhone: maskPhone(row.primaryPhone),
      secondaryPhone: maskPhone(row.secondaryPhone),
      skills: skillRows.filter((s) => s.caregiverId === row.id).map((s) => s.skillName),
      languages: languageRows.filter((l) => l.caregiverId === row.id).map((l) => l.languageName),
      locations: locationRows.filter((l) => l.caregiverId === row.id).map((l) => l.city),
    }));

    return {
      items,
      page: query.page,
      pageSize: query.pageSize,
      total: Number(total),
      totalPages: Math.ceil(Number(total) / query.pageSize),
    };
  }

  async findOne(id: string) {
    const [caregiver] = await this.db.select().from(caregivers).where(eq(caregivers.id, id)).limit(1);
    if (!caregiver || caregiver.deletedAt) {
      throw new NotFoundException('Caregiver not found');
    }

    const [caregiverSkillRows, caregiverLanguageRows, documents] = await Promise.all([
      this.db
        .select({
          skillId: caregiverSkills.skillId,
          name: skills.name,
          proficiency: caregiverSkills.proficiency,
          yearsOfExperience: caregiverSkills.yearsOfExperience,
        })
        .from(caregiverSkills)
        .innerJoin(skills, eq(caregiverSkills.skillId, skills.id))
        .where(eq(caregiverSkills.caregiverId, id)),
      this.db
        .select({
          languageId: caregiverLanguages.languageId,
          name: languages.name,
          proficiency: caregiverLanguages.proficiency,
        })
        .from(caregiverLanguages)
        .innerJoin(languages, eq(caregiverLanguages.languageId, languages.id))
        .where(eq(caregiverLanguages.caregiverId, id)),
      this.db
        .select({
          id: caregiverDocuments.id,
          documentType: caregiverDocuments.documentType,
          originalFilename: caregiverDocuments.originalFilename,
          verificationStatus: caregiverDocuments.verificationStatus,
          createdAt: caregiverDocuments.createdAt,
        })
        .from(caregiverDocuments)
        .where(eq(caregiverDocuments.caregiverId, id)),
    ]);

    return {
      ...caregiver,
      skills: caregiverSkillRows,
      languages: caregiverLanguageRows,
      documents,
    };
  }

  async update(id: string, dto: UpdateCaregiverDto) {
    const existing = await this.findOne(id);
    await assertUniqueContactFields(this.db, dto, id);
    // Only null out the pair when this edit actually names one. A partial
    // update that touches neither district nor city must leave the existing
    // location alone, so this returns null for an untouched form rather than
    // an empty pair.
    const location = await resolveLocationRefs(this.db, dto);

    // Explicit allowlist rather than spreading the DTO. The derived columns
    // (district/city/postalCode) are written from `location` below and must
    // not be settable directly, or a client could desynchronise them from the
    // ids that search and ranking actually match on.
    const updateData: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(dto)) {
      if (key === 'districtId' || key === 'cityId') continue;
      // `.has`, not `in`: `in` on a Set tests for a property, not for
      // membership, so `in` silently rejected every field and update() wrote
      // nothing but the location columns.
      if (!UPDATABLE_COLUMNS.has(key)) continue;
      // Convert empty strings to null for nullable fields to avoid unique
      // constraint violations and keep the data clean.
      updateData[key] = value === '' ? null : value;
    }
    if (dto.dateOfBirth) updateData.dateOfBirth = dto.dateOfBirth as unknown as Date;
    if (location) {
      updateData.districtId = location.districtId;
      updateData.cityId = location.cityId;
      updateData.district = location.district;
      updateData.city = location.city;
      updateData.postalCode = location.postalCode;
    }

    if (Object.keys(updateData).length) {
      await this.db.update(caregivers).set(updateData).where(eq(caregivers.id, id));
    }
    return this.findOne(id);
  }

  async updateStatus(id: string, nextStatus: CaregiverStatus, requesterRole?: string) {
    const current = await this.findOne(id);
    const allowed = CAREGIVER_STATUS_TRANSITIONS[current.status as CaregiverStatus];
    if (!allowed.includes(nextStatus)) {
      throw new BadRequestException(
        `Cannot transition caregiver from ${current.status} to ${nextStatus}. Allowed next states: ${allowed.join(', ') || 'none'}`,
      );
    }
    // A caregiver acting on their own record may only submit their
    // registration (DRAFT -> REGISTERED) - every other transition requires
    // staff/verifier judgment, even though CaregiverScope lets them reach
    // this endpoint at all for that one case.
    if (requesterRole === 'CAREGIVER' && !(current.status === 'DRAFT' && nextStatus === 'REGISTERED')) {
      throw new BadRequestException('Caregivers may only submit their own registration (DRAFT to REGISTERED)');
    }
    await this.db.update(caregivers).set({ status: nextStatus }).where(eq(caregivers.id, id));
    return this.findOne(id);
  }

  async remove(id: string) {
    await this.findOne(id);
    await this.db.update(caregivers).set({ deletedAt: new Date() }).where(eq(caregivers.id, id));
    return { success: true };
  }

  async dashboardStats() {
    const rows = await this.db
      .select({ status: caregivers.status, total: sql<number>`count(*)` })
      .from(caregivers)
      .where(isNull(caregivers.deletedAt))
      .groupBy(caregivers.status);

    const counts: Record<string, number> = {};
    for (const row of rows) counts[row.status] = Number(row.total);

    const [{ pendingDocuments }] = await this.db
      .select({ pendingDocuments: sql<number>`count(*)` })
      .from(caregiverDocuments)
      .where(eq(caregiverDocuments.verificationStatus, 'PENDING'));

    const totalCaregivers = Object.values(counts).reduce((sum, n) => sum + n, 0);

    return {
      totalCaregivers,
      pendingRegistration: counts.DRAFT ?? 0,
      awaitingVerification: (counts.UNDER_VERIFICATION ?? 0) + (counts.DOCUMENTS_PENDING ?? 0),
      verified: counts.VERIFIED ?? 0,
      active: counts.ACTIVE ?? 0,
      suspended: counts.SUSPENDED ?? 0,
      inactive: counts.INACTIVE ?? 0,
      rejected: counts.REJECTED ?? 0,
      documentsRequiringAttention: Number(pendingDocuments),
      byStatus: counts,
    };
  }
}
