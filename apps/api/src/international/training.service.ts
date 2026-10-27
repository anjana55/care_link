import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID as uuid } from 'crypto';
import { and, asc, count, desc, eq, inArray, isNull, ne } from 'drizzle-orm';
import {
  resolveLocale,
  type CaregiverTrainingEnrolment,
  type Locale,
  type PublicCertificate,
  type PublicCertificateCheck,
  type PublicTrainingProgramme,
  type TrainingCertificate,
  type TrainingEnrolmentRow,
  type TrainingProgramme,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { caregivers, sharedProfiles, trainingCertificates, trainingEnrolments, trainingProgrammes } from '../database/schema';
import { TrainingProgrammeDto, UpdateTrainingEnrolmentDto } from './dto/international.dto';
import { randomCode, withUniqueRetry } from './codes';

type CertificateRow = typeof trainingCertificates.$inferSelect;

export function toCertificate(c: CertificateRow): TrainingCertificate {
  return {
    id: c.id,
    number: c.number,
    verifyCode: c.verifyCode,
    programmeId: c.programmeId,
    programmeTitle: c.programmeTitle,
    holderName: c.holderName,
    issuedOn: c.issuedOn,
    score: c.score,
    revoked: !!c.revokedAt,
    revokedReason: c.revokedReason,
  };
}

/** The first word of a full name, for the public certificate check. */
export function firstNameOf(fullName: string): string {
  return (fullName.trim().split(/\s+/)[0] ?? '').slice(0, 60);
}

/**
 * Whether completion can be recorded with this score. A programme with a
 * pass mark needs a score at or above it; one without needs none.
 */
export function checkCompletion(passMark: number | null, score: number | null): void {
  if (passMark === null) return;
  if (score === null) throw new BadRequestException(`Record the final score: this programme's pass mark is ${passMark}.`);
  if (score < passMark) throw new BadRequestException(`The score is below this programme's pass mark (${passMark}). Keep them enrolled, or withdraw them.`);
}

type ProgrammeRow = typeof trainingProgrammes.$inferSelect;

/** The programme's text in `locale`, falling back to English where it has not been translated. */
export function localiseProgramme(row: ProgrammeRow, locale: Locale): PublicTrainingProgramme {
  const title = locale === 'si' ? row.titleSi : locale === 'ta' ? row.titleTa : null;
  const description = locale === 'si' ? row.descriptionSi : locale === 'ta' ? row.descriptionTa : null;
  return {
    id: row.id,
    category: row.category,
    format: row.format,
    title: title || row.titleEn,
    description: description || row.descriptionEn,
    duration: row.duration,
    feeLkr: row.feeLkr,
    nextStartDate: row.nextStartDate,
  };
}

const todayColombo = () => new Date(Date.now() + 5.5 * 3600_000).toISOString().slice(0, 10);

/**
 * The platform's own training: English and basic caregiving to start with,
 * not tied to any destination country. Not an accredited qualification - the
 * public site calls a finished programme "completed", never "certified".
 */
@Injectable()
export class TrainingService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  // --- public / caregiver ----------------------------------------------------

  async activeProgrammes(localeParam?: string): Promise<PublicTrainingProgramme[]> {
    const locale = resolveLocale(localeParam);
    const rows = await this.db
      .select()
      .from(trainingProgrammes)
      .where(eq(trainingProgrammes.isActive, true))
      .orderBy(asc(trainingProgrammes.sortOrder), asc(trainingProgrammes.titleEn));
    return rows.map((r) => localiseProgramme(r, locale));
  }

  async enrolmentsFor(caregiverId: string): Promise<CaregiverTrainingEnrolment[]> {
    const rows = await this.db
      .select({ e: trainingEnrolments, cert: trainingCertificates })
      .from(trainingEnrolments)
      .leftJoin(trainingCertificates, eq(trainingCertificates.enrolmentId, trainingEnrolments.id))
      .where(eq(trainingEnrolments.caregiverId, caregiverId));
    return rows.map(({ e, cert }) => ({
      id: e.id,
      programmeId: e.programmeId,
      status: e.status,
      completedAt: e.completedAt,
      progressPercent: e.progressPercent,
      score: e.score,
      certificate: cert ? toCertificate(cert) : null,
    }));
  }

  // --- certificates ------------------------------------------------------------

  /** Live certificates for talent profiles. */
  async publicCertificates(caregiverIds: string[]): Promise<Map<string, PublicCertificate[]>> {
    const result = new Map<string, PublicCertificate[]>();
    if (!caregiverIds.length) return result;
    const rows = await this.db
      .select()
      .from(trainingCertificates)
      .where(and(inArray(trainingCertificates.caregiverId, caregiverIds), isNull(trainingCertificates.revokedAt)))
      .orderBy(desc(trainingCertificates.issuedOn));
    for (const c of rows) {
      const list = result.get(c.caregiverId) ?? [];
      list.push({ number: c.number, verifyCode: c.verifyCode, programmeTitle: c.programmeTitle, issuedOn: c.issuedOn });
      result.set(c.caregiverId, list);
    }
    return result;
  }

  /**
   * The public check behind the QR code on a certificate. Says whether the
   * number is genuine and still stands, and the first name it was issued to
   * - enough to match the paper in front of you, not enough to find anyone.
   */
  async checkCertificate(code: string): Promise<PublicCertificateCheck> {
    const [c] = await this.db.select().from(trainingCertificates).where(eq(trainingCertificates.verifyCode, code.toUpperCase())).limit(1);
    if (!c) throw new NotFoundException('Certificate not found');
    return { number: c.number, firstName: c.holderFirstName, programmeTitle: c.programmeTitle, issuedOn: c.issuedOn, status: c.revokedAt ? 'REVOKED' : 'VALID' };
  }

  async revokeCertificate(id: string, reason: string): Promise<TrainingCertificate> {
    const [c] = await this.db.select().from(trainingCertificates).where(eq(trainingCertificates.id, id)).limit(1);
    if (!c) throw new NotFoundException('Certificate not found');
    if (!c.revokedAt) await this.db.update(trainingCertificates).set({ revokedAt: new Date(), revokedReason: reason }).where(eq(trainingCertificates.id, id));
    const [after] = await this.db.select().from(trainingCertificates).where(eq(trainingCertificates.id, id)).limit(1);
    return toCertificate(after);
  }

  async certificatesIssuedCount(): Promise<number> {
    const [{ n }] = await this.db.select({ n: count() }).from(trainingCertificates).where(isNull(trainingCertificates.revokedAt));
    return Number(n);
  }

  /**
   * Issues the certificate for a completed enrolment, or brings back one that
   * was revoked when completion was undone. One per enrolment.
   */
  private async issueCertificate(enrolmentId: string, userId: string | null): Promise<void> {
    const [row] = await this.db
      .select({ e: trainingEnrolments, programme: trainingProgrammes, fullName: caregivers.fullName, sharedFirstName: sharedProfiles.firstName })
      .from(trainingEnrolments)
      .innerJoin(trainingProgrammes, eq(trainingEnrolments.programmeId, trainingProgrammes.id))
      .innerJoin(caregivers, eq(trainingEnrolments.caregiverId, caregivers.id))
      .leftJoin(sharedProfiles, eq(sharedProfiles.caregiverId, trainingEnrolments.caregiverId))
      .where(eq(trainingEnrolments.id, enrolmentId))
      .limit(1);
    if (!row) return;
    const [existing] = await this.db.select().from(trainingCertificates).where(eq(trainingCertificates.enrolmentId, enrolmentId)).limit(1);
    const issuedOn = row.e.completedAt ?? todayColombo();
    if (existing) {
      // Re-completed after an undo, or the score changed: the same number stands.
      await this.db
        .update(trainingCertificates)
        .set({ revokedAt: null, revokedReason: null, score: row.e.score, issuedOn: existing.revokedAt ? issuedOn : existing.issuedOn })
        .where(eq(trainingCertificates.id, existing.id));
      return;
    }
    const year = issuedOn.slice(0, 4);
    await withUniqueRetry(() =>
      this.db.insert(trainingCertificates).values({
        id: uuid(),
        number: `TC-${year}-${randomCode(6)}`,
        verifyCode: randomCode(12),
        enrolmentId,
        caregiverId: row.e.caregiverId,
        programmeId: row.e.programmeId,
        programmeTitle: row.programme.titleEn,
        holderName: row.fullName,
        // The name they already chose to share publicly, if any; else the first word of their name.
        holderFirstName: row.sharedFirstName || firstNameOf(row.fullName),
        issuedOn,
        score: row.e.score,
        issuedByUserId: userId,
      }),
    );
  }

  /** "I'm interested": a new sign-up, or a withdrawn one picked up again. */
  async registerInterest(caregiverId: string, programmeId: string): Promise<CaregiverTrainingEnrolment[]> {
    const [programme] = await this.db.select({ isActive: trainingProgrammes.isActive }).from(trainingProgrammes).where(eq(trainingProgrammes.id, programmeId)).limit(1);
    if (!programme) throw new NotFoundException('Programme not found');
    if (!programme.isActive) throw new BadRequestException('This programme is not taking sign-ups.');

    const [existing] = await this.db
      .select({ id: trainingEnrolments.id, status: trainingEnrolments.status })
      .from(trainingEnrolments)
      .where(and(eq(trainingEnrolments.caregiverId, caregiverId), eq(trainingEnrolments.programmeId, programmeId)))
      .limit(1);
    if (!existing) {
      await this.db.insert(trainingEnrolments).values({ id: uuid(), caregiverId, programmeId, status: 'INTERESTED' });
    } else if (existing.status === 'WITHDRAWN') {
      await this.db.update(trainingEnrolments).set({ status: 'INTERESTED', updatedAt: new Date() }).where(eq(trainingEnrolments.id, existing.id));
    }
    return this.enrolmentsFor(caregiverId);
  }

  /** The caregiver steps back. A completed programme stays completed. */
  async withdraw(caregiverId: string, programmeId: string): Promise<CaregiverTrainingEnrolment[]> {
    await this.db
      .update(trainingEnrolments)
      .set({ status: 'WITHDRAWN', updatedAt: new Date() })
      .where(
        and(
          eq(trainingEnrolments.caregiverId, caregiverId),
          eq(trainingEnrolments.programmeId, programmeId),
          inArray(trainingEnrolments.status, ['INTERESTED', 'ENROLLED']),
        ),
      );
    return this.enrolmentsFor(caregiverId);
  }

  /** Titles of the programmes a caregiver has completed, for their shared profile. */
  async completedTitles(caregiverIds: string[], locale: Locale): Promise<Map<string, string[]>> {
    const result = new Map<string, string[]>();
    if (!caregiverIds.length) return result;
    const rows = await this.db
      .select({ caregiverId: trainingEnrolments.caregiverId, programme: trainingProgrammes })
      .from(trainingEnrolments)
      .innerJoin(trainingProgrammes, eq(trainingEnrolments.programmeId, trainingProgrammes.id))
      .where(and(inArray(trainingEnrolments.caregiverId, caregiverIds), eq(trainingEnrolments.status, 'COMPLETED')))
      .orderBy(asc(trainingProgrammes.sortOrder));
    for (const r of rows) {
      const list = result.get(r.caregiverId) ?? [];
      list.push(localiseProgramme(r.programme, locale).title);
      result.set(r.caregiverId, list);
    }
    return result;
  }

  async completionCount(): Promise<number> {
    const [{ n }] = await this.db.select({ n: count() }).from(trainingEnrolments).where(eq(trainingEnrolments.status, 'COMPLETED'));
    return Number(n);
  }

  // --- staff -----------------------------------------------------------------

  async allProgrammes(): Promise<TrainingProgramme[]> {
    const [rows, counts] = await Promise.all([
      this.db.select().from(trainingProgrammes).orderBy(desc(trainingProgrammes.isActive), asc(trainingProgrammes.sortOrder), asc(trainingProgrammes.titleEn)),
      this.db
        .select({ programmeId: trainingEnrolments.programmeId, n: count() })
        .from(trainingEnrolments)
        .where(ne(trainingEnrolments.status, 'WITHDRAWN'))
        .groupBy(trainingEnrolments.programmeId),
    ]);
    const by = new Map(counts.map((c) => [c.programmeId, Number(c.n)]));
    return rows.map((r) => toProgramme(r, by.get(r.id) ?? 0));
  }

  async createProgramme(dto: TrainingProgrammeDto): Promise<TrainingProgramme> {
    const id = uuid();
    await this.db.insert(trainingProgrammes).values({ id, ...programmeValues(dto) });
    return this.programme(id);
  }

  async updateProgramme(id: string, dto: TrainingProgrammeDto): Promise<TrainingProgramme> {
    await this.programme(id);
    await this.db.update(trainingProgrammes).set({ ...programmeValues(dto), updatedAt: new Date() }).where(eq(trainingProgrammes.id, id));
    return this.programme(id);
  }

  async enrolments(programmeId: string): Promise<TrainingEnrolmentRow[]> {
    await this.programme(programmeId);
    const rows = await this.db
      .select({
        id: trainingEnrolments.id,
        caregiverId: trainingEnrolments.caregiverId,
        registrationNumber: caregivers.registrationNumber,
        fullName: caregivers.fullName,
        status: trainingEnrolments.status,
        completedAt: trainingEnrolments.completedAt,
        staffNote: trainingEnrolments.staffNote,
        progressPercent: trainingEnrolments.progressPercent,
        score: trainingEnrolments.score,
        createdAt: trainingEnrolments.createdAt,
        cert: trainingCertificates,
      })
      .from(trainingEnrolments)
      .innerJoin(caregivers, eq(trainingEnrolments.caregiverId, caregivers.id))
      .leftJoin(trainingCertificates, eq(trainingCertificates.enrolmentId, trainingEnrolments.id))
      .where(eq(trainingEnrolments.programmeId, programmeId))
      .orderBy(asc(trainingEnrolments.createdAt));
    return rows.map(({ cert, ...r }) => ({ ...r, certificate: cert ? toCertificate(cert) : null, createdAt: new Date(r.createdAt).toISOString() }));
  }

  /**
   * Status, progress and score. Recording completion issues the certificate
   * of completion (with a passing score, if the programme has a pass mark);
   * moving a completed enrolment back revokes it.
   */
  async updateEnrolment(id: string, dto: UpdateTrainingEnrolmentDto, userId: string | null = null): Promise<TrainingEnrolmentRow> {
    const [row] = await this.db
      .select({ e: trainingEnrolments, passMark: trainingProgrammes.passMark })
      .from(trainingEnrolments)
      .innerJoin(trainingProgrammes, eq(trainingEnrolments.programmeId, trainingProgrammes.id))
      .where(eq(trainingEnrolments.id, id))
      .limit(1);
    if (!row) throw new NotFoundException('Enrolment not found');
    const score = dto.score !== undefined ? dto.score : row.e.score;
    if (dto.status === 'COMPLETED') checkCompletion(row.passMark, score);
    const completedAt = dto.status === 'COMPLETED' ? (dto.completedAt ?? row.e.completedAt ?? todayColombo()) : null;
    await this.db
      .update(trainingEnrolments)
      .set({
        status: dto.status,
        completedAt,
        ...(dto.staffNote !== undefined ? { staffNote: dto.staffNote } : {}),
        ...(dto.progressPercent !== undefined ? { progressPercent: dto.progressPercent } : {}),
        ...(dto.status === 'COMPLETED' ? { progressPercent: 100 } : {}),
        ...(dto.score !== undefined ? { score: dto.score } : {}),
        updatedAt: new Date(),
      })
      .where(eq(trainingEnrolments.id, id));
    if (dto.status === 'COMPLETED') {
      await this.issueCertificate(id, userId);
    } else if (row.e.status === 'COMPLETED') {
      await this.db
        .update(trainingCertificates)
        .set({ revokedAt: new Date(), revokedReason: 'Completion was withdrawn.' })
        .where(and(eq(trainingCertificates.enrolmentId, id), isNull(trainingCertificates.revokedAt)));
    }
    return (await this.enrolments(row.e.programmeId)).find((e) => e.id === id)!;
  }

  private async programme(id: string): Promise<TrainingProgramme> {
    const [row] = await this.db.select().from(trainingProgrammes).where(eq(trainingProgrammes.id, id)).limit(1);
    if (!row) throw new NotFoundException('Programme not found');
    const [{ n }] = await this.db
      .select({ n: count() })
      .from(trainingEnrolments)
      .where(and(eq(trainingEnrolments.programmeId, id), ne(trainingEnrolments.status, 'WITHDRAWN')));
    return toProgramme(row, Number(n));
  }
}

function programmeValues(dto: TrainingProgrammeDto) {
  return {
    category: dto.category,
    format: dto.format,
    titleEn: dto.titleEn,
    titleSi: dto.titleSi ?? null,
    titleTa: dto.titleTa ?? null,
    descriptionEn: dto.descriptionEn,
    descriptionSi: dto.descriptionSi ?? null,
    descriptionTa: dto.descriptionTa ?? null,
    duration: dto.duration ?? null,
    feeLkr: dto.feeLkr ?? null,
    nextStartDate: dto.nextStartDate ?? null,
    isActive: dto.isActive ?? true,
    sortOrder: dto.sortOrder ?? 0,
    passMark: dto.passMark ?? null,
  };
}

function toProgramme(r: ProgrammeRow, enrolmentCount: number): TrainingProgramme {
  return {
    id: r.id,
    category: r.category,
    format: r.format,
    titleEn: r.titleEn,
    titleSi: r.titleSi,
    titleTa: r.titleTa,
    descriptionEn: r.descriptionEn,
    descriptionSi: r.descriptionSi,
    descriptionTa: r.descriptionTa,
    duration: r.duration,
    feeLkr: r.feeLkr,
    nextStartDate: r.nextStartDate,
    isActive: r.isActive,
    sortOrder: r.sortOrder,
    passMark: r.passMark,
    enrolmentCount,
  };
}
