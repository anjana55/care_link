import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID as uuid } from 'crypto';
import { and, count, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { assessmentCurrent, type CaregiverAssessment, type PublicAssessment, type StaffAssessment } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { caregiverAssessments, caregivers } from '../database/schema';
import { AssessmentDto, StaffAssessmentQueryDto } from './dto/phase4.dto';
import { iso } from './employer-enquiries.service';
import { todayColombo } from './dates';

type AssessmentRow = typeof caregiverAssessments.$inferSelect;

/** How many results a caregiver may add themselves while staff have not verified them. */
export const MAX_UNVERIFIED_PER_CAREGIVER = 10;

export function checkDates(dto: Pick<AssessmentDto, 'takenOn' | 'validUntil'>, today = todayColombo()): void {
  if (dto.takenOn > today) throw new BadRequestException('The test date cannot be in the future.');
  if (dto.validUntil && dto.validUntil < dto.takenOn) throw new BadRequestException('A result cannot run out before the test was taken.');
}

function toAssessment(r: AssessmentRow): CaregiverAssessment {
  return {
    id: r.id,
    kind: r.kind,
    provider: r.provider,
    title: r.title,
    score: r.score,
    cefrLevel: r.cefrLevel,
    takenOn: r.takenOn,
    validUntil: r.validUntil,
    verified: !!r.verifiedAt,
    addedBy: r.addedBy,
    createdAt: iso(r.createdAt),
  };
}

/**
 * Test results - English tests above all, which most destinations ask for.
 * Caregivers can add their own; a result only counts (readiness, the talent
 * profile) once staff have seen the original and verified it. Caregivers
 * can remove a result until it is verified; after that only staff change it.
 */
@Injectable()
export class AssessmentsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  // --- the caregiver -------------------------------------------------------------

  async forCaregiver(caregiverId: string): Promise<CaregiverAssessment[]> {
    const rows = await this.db.select().from(caregiverAssessments).where(eq(caregiverAssessments.caregiverId, caregiverId)).orderBy(desc(caregiverAssessments.takenOn));
    return rows.map(toAssessment);
  }

  async addByCaregiver(caregiverId: string, dto: AssessmentDto): Promise<CaregiverAssessment[]> {
    checkDates(dto);
    const [{ n }] = await this.db
      .select({ n: count() })
      .from(caregiverAssessments)
      .where(and(eq(caregiverAssessments.caregiverId, caregiverId), isNull(caregiverAssessments.verifiedAt)));
    if (Number(n) >= MAX_UNVERIFIED_PER_CAREGIVER) throw new BadRequestException('You have results waiting for our team to check. Please wait for those first.');
    // A caregiver cannot claim our own assessment: staff record those.
    if (dto.provider === 'PLATFORM') throw new BadRequestException('Our own assessments are recorded by our team.');
    await this.db.insert(caregiverAssessments).values({ id: uuid(), caregiverId, ...values(dto), note: null, addedBy: 'CAREGIVER' });
    return this.forCaregiver(caregiverId);
  }

  /** A caregiver may remove a result staff have not verified yet. */
  async removeByCaregiver(caregiverId: string, id: string): Promise<CaregiverAssessment[]> {
    const row = await this.row(id);
    if (row.caregiverId !== caregiverId) throw new NotFoundException('Result not found');
    if (row.verifiedAt) throw new BadRequestException('This result has been verified. Ask our team if it needs to change.');
    await this.db.delete(caregiverAssessments).where(eq(caregiverAssessments.id, id));
    return this.forCaregiver(caregiverId);
  }

  /** Verified results still in date, for talent profiles. */
  async publicFor(caregiverIds: string[], today = todayColombo()): Promise<Map<string, PublicAssessment[]>> {
    const result = new Map<string, PublicAssessment[]>();
    if (!caregiverIds.length) return result;
    const rows = await this.db
      .select()
      .from(caregiverAssessments)
      .where(and(inArray(caregiverAssessments.caregiverId, caregiverIds), isNotNull(caregiverAssessments.verifiedAt)))
      .orderBy(desc(caregiverAssessments.takenOn));
    for (const r of rows) {
      if (!assessmentCurrent(r, today)) continue;
      const list = result.get(r.caregiverId) ?? [];
      list.push({ kind: r.kind, provider: r.provider, title: r.title, score: r.score, cefrLevel: r.cefrLevel, takenOn: r.takenOn });
      result.set(r.caregiverId, list);
    }
    return result;
  }

  // --- staff ------------------------------------------------------------------------

  async staffList(query: StaffAssessmentQueryDto): Promise<StaffAssessment[]> {
    const status = query.status ?? 'pending';
    const where = and(
      status === 'pending' ? isNull(caregiverAssessments.verifiedAt) : status === 'verified' ? isNotNull(caregiverAssessments.verifiedAt) : undefined,
      query.caregiverId ? eq(caregiverAssessments.caregiverId, query.caregiverId) : undefined,
    );
    const rows = await this.db
      .select({ a: caregiverAssessments, fullName: caregivers.fullName, registrationNumber: caregivers.registrationNumber })
      .from(caregiverAssessments)
      .innerJoin(caregivers, eq(caregiverAssessments.caregiverId, caregivers.id))
      .where(where)
      .orderBy(desc(caregiverAssessments.createdAt))
      .limit(300);
    return rows.map((r) => toStaff(r.a, r.fullName, r.registrationNumber));
  }

  /** Staff record a result for a caregiver - verified, since they are looking at the original. */
  async createByStaff(caregiverId: string, dto: AssessmentDto, userId: string): Promise<StaffAssessment> {
    checkDates(dto);
    const [cg] = await this.db.select({ id: caregivers.id }).from(caregivers).where(eq(caregivers.id, caregiverId)).limit(1);
    if (!cg) throw new NotFoundException('Caregiver not found');
    const id = uuid();
    await this.db.insert(caregiverAssessments).values({
      id,
      caregiverId,
      ...values(dto),
      note: dto.note ?? null,
      addedBy: 'STAFF',
      verifiedAt: new Date(),
      verifiedByUserId: userId,
    });
    return this.staffGet(id);
  }

  async updateByStaff(id: string, dto: AssessmentDto): Promise<StaffAssessment> {
    checkDates(dto);
    await this.row(id);
    await this.db
      .update(caregiverAssessments)
      .set({ ...values(dto), ...(dto.note !== undefined ? { note: dto.note } : {}), updatedAt: new Date() })
      .where(eq(caregiverAssessments.id, id));
    return this.staffGet(id);
  }

  async verify(id: string, verified: boolean, userId: string): Promise<StaffAssessment> {
    await this.row(id);
    await this.db
      .update(caregiverAssessments)
      .set(verified ? { verifiedAt: new Date(), verifiedByUserId: userId, updatedAt: new Date() } : { verifiedAt: null, verifiedByUserId: null, updatedAt: new Date() })
      .where(eq(caregiverAssessments.id, id));
    return this.staffGet(id);
  }

  async remove(id: string): Promise<void> {
    await this.row(id);
    await this.db.delete(caregiverAssessments).where(eq(caregiverAssessments.id, id));
  }

  async pendingCount(): Promise<number> {
    const [{ n }] = await this.db.select({ n: count() }).from(caregiverAssessments).where(isNull(caregiverAssessments.verifiedAt));
    return Number(n);
  }

  private async staffGet(id: string): Promise<StaffAssessment> {
    const [r] = await this.db
      .select({ a: caregiverAssessments, fullName: caregivers.fullName, registrationNumber: caregivers.registrationNumber })
      .from(caregiverAssessments)
      .innerJoin(caregivers, eq(caregiverAssessments.caregiverId, caregivers.id))
      .where(eq(caregiverAssessments.id, id))
      .limit(1);
    if (!r) throw new NotFoundException('Result not found');
    return toStaff(r.a, r.fullName, r.registrationNumber);
  }

  private async row(id: string): Promise<AssessmentRow> {
    const [row] = await this.db.select().from(caregiverAssessments).where(eq(caregiverAssessments.id, id)).limit(1);
    if (!row) throw new NotFoundException('Result not found');
    return row;
  }
}

function values(dto: AssessmentDto) {
  return {
    kind: dto.kind,
    provider: dto.provider,
    title: dto.title,
    score: dto.score ?? null,
    cefrLevel: dto.cefrLevel ?? null,
    takenOn: dto.takenOn,
    validUntil: dto.validUntil ?? null,
  };
}

function toStaff(a: AssessmentRow, fullName: string, registrationNumber: string): StaffAssessment {
  return {
    ...toAssessment(a),
    caregiverId: a.caregiverId,
    fullName,
    registrationNumber,
    note: a.note,
    verifiedAt: a.verifiedAt ? iso(a.verifiedAt) : null,
  };
}
