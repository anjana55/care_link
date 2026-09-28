import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { DRIZZLE, type Database } from '../database/database.module';
import { qualifications } from '../database/schema';
import { CreateQualificationDto } from './dto/create-qualification.dto';

@Injectable()
export class QualificationsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  findAllForCaregiver(caregiverId: string) {
    return this.db.select().from(qualifications).where(eq(qualifications.caregiverId, caregiverId));
  }

  async create(caregiverId: string, dto: CreateQualificationDto) {
    const id = uuid();
    await this.db.insert(qualifications).values({
      id,
      caregiverId,
      name: dto.name,
      type: dto.type,
      institution: dto.institution,
      certificateNumber: dto.certificateNumber ?? null,
      issueDate: (dto.issueDate as unknown as Date) ?? null,
      expiryDate: (dto.expiryDate as unknown as Date) ?? null,
      documentId: dto.documentId ?? null,
    });
    return this.findOne(caregiverId, id);
  }

  async findOne(caregiverId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(qualifications)
      .where(and(eq(qualifications.id, id), eq(qualifications.caregiverId, caregiverId)))
      .limit(1);
    if (!row) throw new NotFoundException('Qualification not found');
    return row;
  }

  async update(caregiverId: string, id: string, dto: Partial<CreateQualificationDto>) {
    await this.findOne(caregiverId, id);
    await this.db
      .update(qualifications)
      .set(dto as Record<string, unknown>)
      .where(and(eq(qualifications.id, id), eq(qualifications.caregiverId, caregiverId)));
    return this.findOne(caregiverId, id);
  }

  async remove(caregiverId: string, id: string) {
    await this.findOne(caregiverId, id);
    await this.db.delete(qualifications).where(and(eq(qualifications.id, id), eq(qualifications.caregiverId, caregiverId)));
    return { success: true };
  }

  async setVerificationStatus(caregiverId: string, id: string, status: 'PENDING' | 'IN_PROGRESS' | 'VERIFIED' | 'REJECTED') {
    await this.findOne(caregiverId, id);
    await this.db
      .update(qualifications)
      .set({ verificationStatus: status })
      .where(and(eq(qualifications.id, id), eq(qualifications.caregiverId, caregiverId)));
    return this.findOne(caregiverId, id);
  }
}
