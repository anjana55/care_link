import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { DRIZZLE, type Database } from '../database/database.module';
import { experiences } from '../database/schema';
import { CreateExperienceDto } from './dto/create-experience.dto';
import { UpdateExperienceDto } from './dto/update-experience.dto';

@Injectable()
export class ExperiencesService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  findAllForCaregiver(caregiverId: string) {
    return this.db.select().from(experiences).where(eq(experiences.caregiverId, caregiverId));
  }

  async create(caregiverId: string, dto: CreateExperienceDto) {
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
    await this.findOne(caregiverId, id);
    // See QualificationsService.update: a caregiver's edit is unchecked again.
    const changes: Record<string, unknown> = { ...dto };
    if (requesterRole === 'CAREGIVER') changes.verificationStatus = 'PENDING';
    await this.db
      .update(experiences)
      .set(changes)
      .where(and(eq(experiences.id, id), eq(experiences.caregiverId, caregiverId)));
    return this.findOne(caregiverId, id);
  }

  async remove(caregiverId: string, id: string, requesterRole?: string) {
    const row = await this.findOne(caregiverId, id);
    // A caregiver may withdraw an entry nobody has accepted; once it is being
    // checked or verified, deleting it would erase what the check relied on.
    if (requesterRole === 'CAREGIVER' && !['PENDING', 'REJECTED'].includes(row.verificationStatus)) {
      throw new ForbiddenException('This entry is being verified or has been verified, so only staff can remove it.');
    }
    await this.db.delete(experiences).where(and(eq(experiences.id, id), eq(experiences.caregiverId, caregiverId)));
    return { success: true };
  }
}
