import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID as uuid } from 'crypto';
import { and, asc, count, desc, eq, inArray, ne } from 'drizzle-orm';
import {
  resolveLocale,
  type CaregiverTrainingEnrolment,
  type Locale,
  type PublicTrainingProgramme,
  type TrainingEnrolmentRow,
  type TrainingProgramme,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { caregivers, trainingEnrolments, trainingProgrammes } from '../database/schema';
import { TrainingProgrammeDto, UpdateTrainingEnrolmentDto } from './dto/international.dto';

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
      .select({ id: trainingEnrolments.id, programmeId: trainingEnrolments.programmeId, status: trainingEnrolments.status, completedAt: trainingEnrolments.completedAt })
      .from(trainingEnrolments)
      .where(eq(trainingEnrolments.caregiverId, caregiverId));
    return rows;
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
        createdAt: trainingEnrolments.createdAt,
      })
      .from(trainingEnrolments)
      .innerJoin(caregivers, eq(trainingEnrolments.caregiverId, caregivers.id))
      .where(eq(trainingEnrolments.programmeId, programmeId))
      .orderBy(asc(trainingEnrolments.createdAt));
    return rows.map((r) => ({ ...r, createdAt: new Date(r.createdAt).toISOString() }));
  }

  async updateEnrolment(id: string, dto: UpdateTrainingEnrolmentDto): Promise<TrainingEnrolmentRow> {
    const [row] = await this.db.select({ programmeId: trainingEnrolments.programmeId }).from(trainingEnrolments).where(eq(trainingEnrolments.id, id)).limit(1);
    if (!row) throw new NotFoundException('Enrolment not found');
    const completedAt = dto.status === 'COMPLETED' ? (dto.completedAt ?? todayColombo()) : null;
    await this.db
      .update(trainingEnrolments)
      .set({ status: dto.status, completedAt, ...(dto.staffNote !== undefined ? { staffNote: dto.staffNote } : {}), updatedAt: new Date() })
      .where(eq(trainingEnrolments.id, id));
    return (await this.enrolments(row.programmeId)).find((e) => e.id === id)!;
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
    enrolmentCount,
  };
}
