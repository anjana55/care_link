import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { DRIZZLE, type Database } from '../database/database.module';
import { verifications } from '../database/schema';
import { CreateVerificationDto, UpdateVerificationDto } from './dto/verification.dto';

@Injectable()
export class VerificationService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  findAllForCaregiver(caregiverId: string) {
    return this.db.select().from(verifications).where(eq(verifications.caregiverId, caregiverId));
  }

  async create(caregiverId: string, dto: CreateVerificationDto) {
    const id = uuid();
    await this.db.insert(verifications).values({
      id,
      caregiverId,
      verificationType: dto.verificationType,
      status: dto.status ?? 'PENDING',
      notes: dto.notes ?? null,
    });
    return this.findOne(caregiverId, id);
  }

  async findOne(caregiverId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(verifications)
      .where(and(eq(verifications.id, id), eq(verifications.caregiverId, caregiverId)))
      .limit(1);
    if (!row) throw new NotFoundException('Verification record not found');
    return row;
  }

  async update(caregiverId: string, id: string, dto: UpdateVerificationDto, verifiedByUserId: string) {
    await this.findOne(caregiverId, id);
    await this.db
      .update(verifications)
      .set({
        status: dto.status,
        notes: dto.notes,
        verifiedByUserId,
        verifiedAt: dto.status === 'VERIFIED' || dto.status === 'REJECTED' ? new Date() : null,
      })
      .where(and(eq(verifications.id, id), eq(verifications.caregiverId, caregiverId)));
    return this.findOne(caregiverId, id);
  }
}
