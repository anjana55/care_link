import { BadRequestException, ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { DRIZZLE, type Database } from '../database/database.module';
import { caregivers, experiences } from '../database/schema';
import { CreateExperienceDto } from './dto/create-experience.dto';
import { UpdateExperienceDto } from './dto/update-experience.dto';

@Injectable()
export class ExperiencesService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  findAllForCaregiver(caregiverId: string) {
    return this.db.select().from(experiences).where(eq(experiences.caregiverId, caregiverId));
  }

  /** Dates are YYYY-MM-DD strings, so they compare as text. */
  private checkDates(startDate?: string | Date | null, endDate?: string | Date | null) {
    const day = (d: string | Date) => (d instanceof Date ? d.toISOString() : String(d)).slice(0, 10);
    if (startDate && endDate && day(endDate) < day(startDate)) throw new BadRequestException('The end date cannot be before the start date.');
  }

  /**
   * Office staff can't change a caregiver's work history once registered -
   * only while still filling in the registration (a DRAFT), which is when the
   * new-caregiver wizard adds it. After that it is an admin's job.
   */
  private async assertStaffMayChange(caregiverId: string, requesterRole?: string) {
    if (requesterRole !== 'STAFF') return;
    const [row] = await this.db.select({ status: caregivers.status }).from(caregivers).where(eq(caregivers.id, caregiverId)).limit(1);
    if (row?.status !== 'DRAFT') throw new ForbiddenException('Only an admin can change the work history of a registered caregiver.');
  }

  async create(caregiverId: string, dto: CreateExperienceDto, requesterRole?: string) {
    await this.assertStaffMayChange(caregiverId, requesterRole);
    this.checkDates(dto.startDate, dto.endDate);
    const id = uuid();
    await this.db.insert(experiences).values({
      id,
      caregiverId,
      employerOrClient: dto.employerOrClient,
      role: dto.role,
      location: dto.location ?? null,
      country: dto.country,
      startDate: dto.startDate as unknown as Date,
      endDate: (dto.endDate as unknown as Date) ?? null,
      description: dto.description ?? null,
      careType: dto.careType ?? null,
      patientCategory: dto.patientCategory ?? null,
      referenceContact: dto.referenceContact ?? null,
    });
    return this.findOne(caregiverId, id);
  }

  async findOne(caregiverId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(experiences)
      .where(and(eq(experiences.id, id), eq(experiences.caregiverId, caregiverId)))
      .limit(1);
    if (!row) throw new NotFoundException('Experience record not found');
    return row;
  }

  async update(caregiverId: string, id: string, dto: UpdateExperienceDto, requesterRole?: string) {
    const current = await this.findOne(caregiverId, id);
    this.checkDates(dto.startDate ?? current.startDate, dto.endDate === undefined ? current.endDate : dto.endDate);
    // See QualificationsService.update: a caregiver's edit is unchecked again.
    // Only an admin sets the verification status directly.
    const changes: Record<string, unknown> = { ...dto };
    if (requesterRole !== 'ADMIN') delete changes.verificationStatus;
    if (requesterRole === 'CAREGIVER') changes.verificationStatus = 'PENDING';
    await this.db
      .update(experiences)
      .set(changes)
      .where(and(eq(experiences.id, id), eq(experiences.caregiverId, caregiverId)));
    return this.findOne(caregiverId, id);
  }

  async remove(caregiverId: string, id: string, requesterRole?: string) {
    const row = await this.findOne(caregiverId, id);
    await this.assertStaffMayChange(caregiverId, requesterRole);
    // A caregiver may withdraw an entry nobody has accepted; once it is being
    // checked or verified, deleting it would erase what the check relied on.
    if (requesterRole === 'CAREGIVER' && !['PENDING', 'REJECTED'].includes(row.verificationStatus)) {
      throw new ForbiddenException('This entry is being verified or has been verified, so only staff can remove it.');
    }
    await this.db.delete(experiences).where(and(eq(experiences.id, id), eq(experiences.caregiverId, caregiverId)));
    return { success: true };
  }
}
