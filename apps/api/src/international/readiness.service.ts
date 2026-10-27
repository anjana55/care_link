import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, gte, inArray, isNotNull, isNull, like, or, sql } from 'drizzle-orm';
import {
  PASSPORT_MIN_VALIDITY_MONTHS,
  PUBLIC_CAREGIVER_STATUSES,
  VERIFIED_CAREGIVER_STATUSES,
  isCountryCode,
  readinessItemValues,
  type ReadinessItem,
  type ReadinessReport,
  type TalentPoolRow,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  caregiverAssessments,
  caregiverDocuments,
  caregiverLanguages,
  caregiverOverseasProfiles,
  caregivers,
  languages,
  qualifications,
  trainingEnrolments,
  trainingProgrammes,
} from '../database/schema';
import { SharedProfilesService } from './shared-profiles.service';
import { addMonths, todayColombo } from './dates';
import { TalentPoolQueryDto } from './dto/international.dto';

/** Everything readiness is worked out from, for one caregiver. */
export interface ReadinessFacts {
  caregiverStatus: string;
  openToOverseas: boolean;
  targetCountries: number;
  passportHeld: boolean | null;
  passportExpiry: string | null;
  availableFrom: string | null;
  policeClearanceVerified: boolean;
  englishTrainingCompleted: boolean;
  englishFluent: boolean;
  caregivingTrainingCompleted: boolean;
  verifiedQualification: boolean;
  sharedProfileLive: boolean;
}

export { addMonths };

/**
 * Ready to work abroad, in general - not for any one country, since training
 * is not country-specific yet. Each item comes from something staff verify or
 * the caregiver states; nothing here is a judgement call.
 *
 * The passport must still be valid six months after the caregiver could start
 * (or after today, if they have not said) - the common minimum for a work visa.
 */
export function computeReadiness(f: ReadinessFacts, today = todayColombo()): ReadinessReport {
  const start = f.availableFrom && f.availableFrom > today ? f.availableFrom : today;
  const done: Record<ReadinessItem, boolean> = {
    registrationVerified: (VERIFIED_CAREGIVER_STATUSES as readonly string[]).includes(f.caregiverStatus),
    openToOverseas: f.openToOverseas && f.targetCountries > 0,
    passportValid: Boolean(f.passportHeld && f.passportExpiry && f.passportExpiry >= addMonths(start, PASSPORT_MIN_VALIDITY_MONTHS)),
    policeClearance: f.policeClearanceVerified,
    english: f.englishTrainingCompleted || f.englishFluent,
    caregiving: f.caregivingTrainingCompleted || f.verifiedQualification,
    sharedProfile: f.sharedProfileLive,
  };
  const items = readinessItemValues.map((key) => ({ key, done: done[key] }));
  return { items, done: items.filter((i) => i.done).length, total: items.length };
}

/**
 * Readiness for caregivers, and the staff talent pool built on it: every
 * listed caregiver who has said they are open to working abroad.
 */
@Injectable()
export class ReadinessService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly sharedProfiles: SharedProfilesService,
  ) {}

  async forCaregiver(caregiverId: string): Promise<ReadinessReport> {
    const report = (await this.forCaregivers([caregiverId])).get(caregiverId);
    if (!report) throw new NotFoundException('Caregiver not found');
    return report;
  }

  async forCaregivers(caregiverIds: string[]): Promise<Map<string, ReadinessReport>> {
    const facts = await this.facts(caregiverIds);
    return new Map([...facts].map(([id, f]) => [id, computeReadiness(f)]));
  }

  async talentPool(query: TalentPoolQueryDto): Promise<TalentPoolRow[]> {
    const term = query.search ? `%${query.search.replace(/[%_\\]/g, (c) => `\\${c}`)}%` : null;
    const rows = await this.db
      .select({
        id: caregivers.id,
        registrationNumber: caregivers.registrationNumber,
        fullName: caregivers.fullName,
        city: caregivers.city,
        targetCountries: caregiverOverseasProfiles.targetCountries,
        availableFrom: caregiverOverseasProfiles.availableFrom,
      })
      .from(caregiverOverseasProfiles)
      .innerJoin(caregivers, eq(caregiverOverseasProfiles.caregiverId, caregivers.id))
      .where(
        and(
          eq(caregiverOverseasProfiles.openToOverseas, true),
          isNull(caregivers.deletedAt),
          inArray(caregivers.status, [...PUBLIC_CAREGIVER_STATUSES]),
          query.country ? sql`JSON_CONTAINS(${caregiverOverseasProfiles.targetCountries}, ${JSON.stringify(query.country)})` : undefined,
          term ? or(like(caregivers.fullName, term), like(caregivers.registrationNumber, term)) : undefined,
        ),
      )
      .limit(500);
    const ids = rows.map((r) => r.id);
    const [reports, slugs] = await Promise.all([this.forCaregivers(ids), this.sharedProfiles.liveSlugs(ids)]);
    return rows
      .map((r) => ({
        caregiverId: r.id,
        registrationNumber: r.registrationNumber,
        fullName: r.fullName,
        city: r.city,
        targetCountries: (r.targetCountries ?? []).filter(isCountryCode),
        availableFrom: r.availableFrom,
        talentSlug: slugs.get(r.id) ?? null,
        profileLive: slugs.has(r.id),
        readiness: reports.get(r.id)!,
      }))
      .filter((r) => r.readiness && r.readiness.done >= (query.minReady ?? 0))
      .sort((a, b) => b.readiness.done - a.readiness.done || a.fullName.localeCompare(b.fullName));
  }

  /** One query per source, for any number of caregivers. */
  private async facts(caregiverIds: string[]): Promise<Map<string, ReadinessFacts>> {
    const ids = [...new Set(caregiverIds)];
    const out = new Map<string, ReadinessFacts>();
    if (!ids.length) return out;
    const [base, police, training, english, quals, live, englishTests] = await Promise.all([
      this.db
        .select({ id: caregivers.id, status: caregivers.status, overseas: caregiverOverseasProfiles })
        .from(caregivers)
        .leftJoin(caregiverOverseasProfiles, eq(caregiverOverseasProfiles.caregiverId, caregivers.id))
        .where(and(inArray(caregivers.id, ids), isNull(caregivers.deletedAt))),
      this.db
        .selectDistinct({ id: caregiverDocuments.caregiverId })
        .from(caregiverDocuments)
        .where(
          and(
            inArray(caregiverDocuments.caregiverId, ids),
            eq(caregiverDocuments.documentType, 'POLICE_CLEARANCE'),
            eq(caregiverDocuments.verificationStatus, 'VERIFIED'),
            // An expired clearance no longer counts.
            or(isNull(caregiverDocuments.expiresOn), gte(caregiverDocuments.expiresOn, todayColombo())),
          ),
        ),
      this.db
        .selectDistinct({ id: trainingEnrolments.caregiverId, category: trainingProgrammes.category })
        .from(trainingEnrolments)
        .innerJoin(trainingProgrammes, eq(trainingEnrolments.programmeId, trainingProgrammes.id))
        .where(and(inArray(trainingEnrolments.caregiverId, ids), eq(trainingEnrolments.status, 'COMPLETED'))),
      this.db
        .selectDistinct({ id: caregiverLanguages.caregiverId })
        .from(caregiverLanguages)
        .innerJoin(languages, eq(caregiverLanguages.languageId, languages.id))
        .where(
          and(
            inArray(caregiverLanguages.caregiverId, ids),
            or(eq(languages.code, 'en'), eq(languages.name, 'English')),
            inArray(caregiverLanguages.proficiency, ['FLUENT', 'NATIVE']),
          ),
        ),
      this.db
        .selectDistinct({ id: qualifications.caregiverId })
        .from(qualifications)
        .where(and(inArray(qualifications.caregiverId, ids), eq(qualifications.verificationStatus, 'VERIFIED'))),
      this.sharedProfiles.liveSlugs(ids),
      // A verified English test at B1 or above, still in date, counts as English too.
      this.db
        .selectDistinct({ id: caregiverAssessments.caregiverId })
        .from(caregiverAssessments)
        .where(
          and(
            inArray(caregiverAssessments.caregiverId, ids),
            eq(caregiverAssessments.kind, 'ENGLISH'),
            isNotNull(caregiverAssessments.verifiedAt),
            inArray(caregiverAssessments.cefrLevel, ['B1', 'B2', 'C1', 'C2']),
            or(isNull(caregiverAssessments.validUntil), gte(caregiverAssessments.validUntil, todayColombo())),
          ),
        ),
    ]);
    const has = (rows: { id: string }[]) => new Set(rows.map((r) => r.id));
    const policeSet = has(police);
    const englishSet = new Set([...has(english), ...has(englishTests)]);
    const qualSet = has(quals);
    const trainedIn = (category: string) => new Set(training.filter((t) => t.category === category).map((t) => t.id));
    const englishTraining = trainedIn('ENGLISH');
    const caregivingTraining = trainedIn('CAREGIVING');
    for (const { id, status, overseas } of base) {
      out.set(id, {
        caregiverStatus: status,
        openToOverseas: Boolean(overseas?.openToOverseas),
        targetCountries: (overseas?.targetCountries ?? []).length,
        passportHeld: overseas?.passportHeld ?? null,
        passportExpiry: overseas?.passportExpiry ?? null,
        availableFrom: overseas?.availableFrom ?? null,
        policeClearanceVerified: policeSet.has(id),
        englishTrainingCompleted: englishTraining.has(id),
        englishFluent: englishSet.has(id),
        caregivingTrainingCompleted: caregivingTraining.has(id),
        verifiedQualification: qualSet.has(id),
        sharedProfileLive: live.has(id),
      });
    }
    return out;
  }
}
