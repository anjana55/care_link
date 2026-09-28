import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { DRIZZLE, type Database } from '../database/database.module';
import { experiences } from '../database/schema';
import { CreateExperienceDto } from './dto/create-experience.dto';

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

  async update(caregiverId: string, id: string, dto: Partial<CreateExperienceDto>) {
    await this.findOne(caregiverId, id);
    await this.db
      .update(experiences)
      .set(dto as Record<string, unknown>)
      .where(and(eq(experiences.id, id), eq(experiences.caregiverId, caregiverId)));
    return this.findOne(caregiverId, id);
  }

  async remove(caregiverId: string, id: string) {
    await this.findOne(caregiverId, id);
    await this.db.delete(experiences).where(and(eq(experiences.id, id), eq(experiences.caregiverId, caregiverId)));
    return { success: true };
  }
}
