import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { DRIZZLE, type Database } from '../database/database.module';
import { caregiverHealthInformation } from '../database/schema';
import { UpsertHealthInformationDto } from './dto/upsert-health-information.dto';
import { AuditService } from '../audit/audit.service';

@Injectable()
export class HealthInformationService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly auditService: AuditService,
  ) {}

  async findOne(caregiverId: string, requestedByUserId: string, ipAddress?: string) {
    const [row] = await this.db
      .select()
      .from(caregiverHealthInformation)
      .where(eq(caregiverHealthInformation.caregiverId, caregiverId))
      .limit(1);

    // This table is never joined into normal caregiver list/search results;
    // every direct read is logged here, separately from generic @Audit().
    await this.auditService.record({
      userId: requestedByUserId,
      action: 'ACCESS_HEALTH_INFORMATION',
      entityType: 'CaregiverHealthInformation',
      entityId: caregiverId,
      ipAddress,
    });

    return row ?? null;
  }

  async upsert(caregiverId: string, dto: UpsertHealthInformationDto, updatedByUserId: string, ipAddress?: string) {
    const [existing] = await this.db
      .select()
      .from(caregiverHealthInformation)
      .where(eq(caregiverHealthInformation.caregiverId, caregiverId))
      .limit(1);

    if (existing) {
      await this.db
        .update(caregiverHealthInformation)
        .set(dto)
        .where(eq(caregiverHealthInformation.caregiverId, caregiverId));
    } else {
      await this.db.insert(caregiverHealthInformation).values({ id: uuid(), caregiverId, ...dto });
    }

    await this.auditService.record({
      userId: updatedByUserId,
      action: 'UPDATE_HEALTH_INFORMATION',
      entityType: 'CaregiverHealthInformation',
      entityId: caregiverId,
      ipAddress,
    });

    return this.findOne(caregiverId, updatedByUserId, ipAddress);
  }
}
