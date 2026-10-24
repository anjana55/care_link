import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import { DRIZZLE, type Database } from '../database/database.module';
import { careTypeValues, type CareType } from '@care-platform/shared';
import { availability, CARE_TYPE_COLUMNS } from '../database/schema';
import { UpsertAvailabilityDto } from './dto/upsert-availability.dto';

@Injectable()
export class AvailabilityService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  /** The record, plus `careTypes` - the five care_* columns as a list, which is how both apps edit them. */
  async findOne(caregiverId: string) {
    const [row] = await this.db.select().from(availability).where(eq(availability.caregiverId, caregiverId)).limit(1);
    if (!row) return null;
    const careTypes: CareType[] = careTypeValues.filter((type) => row[CARE_TYPE_COLUMNS[type]]);
    return { ...row, careTypes };
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
      // Only when the form sent the list - a save that leaves it out keeps what is there.
      ...(dto.careTypes
        ? Object.fromEntries(careTypeValues.map((type) => [CARE_TYPE_COLUMNS[type], dto.careTypes!.includes(type)]))
        : {}),
    };

    if (existing) {
      await this.db.update(availability).set(values).where(eq(availability.caregiverId, caregiverId));
    } else {
      await this.db.insert(availability).values({ id: uuid(), caregiverId, ...values });
    }
    return this.findOne(caregiverId);
  }
}
