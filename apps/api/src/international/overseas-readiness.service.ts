import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { isCountryCode, type CountryCode, type OverseasReadiness } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { caregiverOverseasProfiles } from '../database/schema';
import { UpdateOverseasReadinessDto } from './dto/international.dto';

const EMPTY: OverseasReadiness = { openToOverseas: false, targetCountries: [], passportHeld: null, passportExpiry: null, availableFrom: null };

/**
 * A caregiver's "Work abroad" answers: whether they want overseas work, where,
 * whether they hold a passport (and until when), and when they could start.
 * Languages and qualifications are not asked again here - they live on the
 * profile, where staff already verify them.
 */
@Injectable()
export class OverseasReadinessService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async get(caregiverId: string): Promise<OverseasReadiness> {
    const [row] = await this.db.select().from(caregiverOverseasProfiles).where(eq(caregiverOverseasProfiles.caregiverId, caregiverId)).limit(1);
    return row ? toReadiness(row) : { ...EMPTY };
  }

  async update(caregiverId: string, dto: UpdateOverseasReadinessDto): Promise<OverseasReadiness> {
    const values = {
      openToOverseas: dto.openToOverseas,
      // Order kept (it is the caregiver's preference), duplicates dropped.
      targetCountries: [...new Set(dto.targetCountries)],
      passportHeld: dto.passportHeld ?? null,
      // No passport, no expiry date.
      passportExpiry: dto.passportHeld ? (dto.passportExpiry ?? null) : null,
      availableFrom: dto.availableFrom ?? null,
      updatedAt: new Date(),
    };
    await this.db
      .insert(caregiverOverseasProfiles)
      .values({ caregiverId, ...values })
      .onDuplicateKeyUpdate({ set: values });
    return this.get(caregiverId);
  }
}

export function toReadiness(row: typeof caregiverOverseasProfiles.$inferSelect): OverseasReadiness {
  return {
    openToOverseas: row.openToOverseas,
    targetCountries: (row.targetCountries ?? []).filter((c): c is CountryCode => isCountryCode(c)),
    passportHeld: row.passportHeld,
    passportExpiry: row.passportExpiry,
    availableFrom: row.availableFrom,
  };
}
