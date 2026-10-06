import { ForbiddenException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { DRIZZLE, type Database } from '../database/database.module';
import { qualifications } from '../database/schema';
import { CreateQualificationDto } from './dto/create-qualification.dto';
import { UpdateQualificationDto } from './dto/update-qualification.dto';

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

  async update(caregiverId: string, id: string, dto: UpdateQualificationDto, requesterRole?: string) {
    await this.findOne(caregiverId, id);
    // Whatever a caregiver changes was not what staff looked at, so an edit by
    // the caregiver puts the record back in the queue instead of leaving a
    // verified badge on text nobody has checked.
    const changes: Record<string, unknown> = { ...dto };
    if (requesterRole === 'CAREGIVER') changes.verificationStatus = 'PENDING';
    await this.db
      .update(qualifications)
      .set(changes)
      .where(and(eq(qualifications.id, id), eq(qualifications.caregiverId, caregiverId)));
    return this.findOne(caregiverId, id);
  }

  async remove(caregiverId: string, id: string, requesterRole?: string) {
    const row = await this.findOne(caregiverId, id);
    // A caregiver may withdraw an entry nobody has accepted; once it is being
    // checked or verified, deleting it would erase what the check relied on.
    if (requesterRole === 'CAREGIVER' && !['PENDING', 'REJECTED'].includes(row.verificationStatus)) {
      throw new ForbiddenException('This entry is being verified or has been verified, so only staff can remove it.');
    }
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
