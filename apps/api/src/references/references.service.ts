import { JobsService } from '../jobs/jobs.service';
import { AutomationService } from '../automation/automation.service';
import { nudgeOnboarding } from '../onboarding/onboarding-jobs';
import { Inject, Injectable, Optional, NotFoundException } from '@nestjs/common';
import { and, eq } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { DRIZZLE, type Database } from '../database/database.module';
import { references } from '../database/schema';
import { CreateReferenceDto } from './dto/create-reference.dto';

@Injectable()
export class ReferencesService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    @Optional() private readonly jobs?: JobsService,
    @Optional() private readonly automation?: AutomationService,
  ) {}

  findAllForCaregiver(caregiverId: string) {
    return this.db.select().from(references).where(eq(references.caregiverId, caregiverId));
  }

  async create(caregiverId: string, dto: CreateReferenceDto) {
    const id = uuid();
    await this.db.insert(references).values({
      id,
      caregiverId,
      name: dto.name,
      relationship: dto.relationship,
      phone: dto.phone,
      email: dto.email ?? null,
      notes: dto.notes ?? null,
    });
    await nudgeOnboarding(this.jobs, this.automation, caregiverId);
    return this.findOne(caregiverId, id);
  }

  async findOne(caregiverId: string, id: string) {
    const [row] = await this.db
      .select()
      .from(references)
      .where(and(eq(references.id, id), eq(references.caregiverId, caregiverId)))
      .limit(1);
    if (!row) throw new NotFoundException('Reference not found');
    return row;
  }

  async setVerificationStatus(caregiverId: string, id: string, status: 'PENDING' | 'IN_PROGRESS' | 'VERIFIED' | 'REJECTED') {
    await this.findOne(caregiverId, id);
    await this.db
      .update(references)
      .set({ verificationStatus: status })
      .where(and(eq(references.id, id), eq(references.caregiverId, caregiverId)));
    return this.findOne(caregiverId, id);
  }

  async remove(caregiverId: string, id: string) {
    await this.findOne(caregiverId, id);
    await this.db.delete(references).where(and(eq(references.id, id), eq(references.caregiverId, caregiverId)));
    return { success: true };
  }
}
