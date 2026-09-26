import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { DRIZZLE, type Database } from '../database/database.module';
import { availability } from '../database/schema';
import { UpsertAvailabilityDto } from './dto/upsert-availability.dto';

@Injectable()
export class AvailabilityService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async findOne(caregiverId: string) {
    const [row] = await this.db.select().from(availability).where(eq(availability.caregiverId, caregiverId)).limit(1);
    return row ?? null;
  }

  async upsert(caregiverId: string, dto: UpsertAvailabilityDto) {
    const existing = await this.findOne(caregiverId);
    const values = {
      dayDuty: dto.dayDuty,
      nightDuty: dto.nightDuty,
      liveIn24h: dto.liveIn24h,
      availableFrom: (dto.availableFrom as unknown as Date) ?? undefined,
      preferredShift: dto.preferredShift,
      expectedDailyRate: dto.expectedDailyRate,
      expectedMonthlyRate: dto.expectedMonthlyRate,
      expectedLeaveDays: dto.expectedLeaveDays,
      preferredLeavePattern: dto.preferredLeavePattern,
    };

    if (existing) {
      await this.db.update(availability).set(values).where(eq(availability.caregiverId, caregiverId));
    } else {
      await this.db.insert(availability).values({ id: uuid(), caregiverId, ...values });
    }
    return this.findOne(caregiverId);
  }
}
