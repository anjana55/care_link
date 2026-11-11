import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, isNull } from 'drizzle-orm';
import { randomUUID as uuid } from 'crypto';
import {
  careTypeValues,
  clientPriceFor,
  defaultPricing,
  rateProblem,
  type CareType,
  type CareTypePricing,
  type CaregiverRateCard,
  type RateQuote,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { availability, CARE_TYPE_COLUMNS, caregiverRates, caregivers, careTypePricing } from '../database/schema';
import type { UpdateCareTypePricingDto, UpdateCaregiverRatesDto } from './dto/pricing.dto';

/**
 * Caregiver-set rates: the admin's pricing per kind of care, each caregiver's
 * own rate card, and the quote a booking is priced from.
 *
 * The client's price is always worked out (rate + fee), never stored, and a
 * rate is always checked against the band as it stands - when it is saved,
 * and again when it is quoted.
 */
@Injectable()
export class PricingService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  // --- the admin's settings --------------------------------------------------------

  /** All five care types, in display order, with defaults for those never set up. */
  async pricing(): Promise<CareTypePricing[]> {
    const rows = await this.db.select().from(careTypePricing);
    const byType = new Map(rows.map((r) => [r.careType, r]));
    return careTypeValues.map((careType) => {
      const r = byType.get(careType);
      return r ? { careType, enabled: r.enabled, rateType: r.rateType, minRate: r.minRate, maxRate: r.maxRate, feePercent: r.feePercent } : defaultPricing(careType);
    });
  }

  private async pricingFor(careType: CareType): Promise<CareTypePricing> {
    return (await this.pricing()).find((p) => p.careType === careType)!;
  }

  async updatePricing(careType: CareType, dto: UpdateCareTypePricingDto, userId: string): Promise<CareTypePricing[]> {
    const next = { ...(await this.pricingFor(careType)), ...Object.fromEntries(Object.entries(dto).filter(([, v]) => v !== undefined)) };
    if (next.maxRate < next.minRate) throw new BadRequestException('The highest rate must not be below the lowest');
    if (next.enabled && next.maxRate <= 0) throw new BadRequestException('Set the lowest and highest rate before switching this on');
    const { careType: _careType, ...values } = next;
    await this.db
      .insert(careTypePricing)
      .values({ careType, ...values, updatedBy: userId })
      .onDuplicateKeyUpdate({ set: { ...values, updatedBy: userId, updatedAt: new Date() } });
    return this.pricing();
  }

  // --- a caregiver's rate card ---------------------------------------------------

  private async caregiverOrThrow(caregiverId: string) {
    const [row] = await this.db.select({ id: caregivers.id }).from(caregivers).where(and(eq(caregivers.id, caregiverId), isNull(caregivers.deletedAt))).limit(1);
    if (!row) throw new NotFoundException('Caregiver not found');
  }

  async rateCard(caregiverId: string): Promise<CaregiverRateCard> {
    await this.caregiverOrThrow(caregiverId);
    const [pricing, rates, [avail]] = await Promise.all([
      this.pricing(),
      this.db.select().from(caregiverRates).where(eq(caregiverRates.caregiverId, caregiverId)),
      this.db.select().from(availability).where(eq(availability.caregiverId, caregiverId)).limit(1),
    ]);
    const byType = new Map(rates.map((r) => [r.careType, r]));
    return {
      caregiverId,
      lines: pricing.map((p) => {
        const rate = byType.get(p.careType);
        const amount = rate?.amount ?? null;
        return {
          careType: p.careType,
          // No availability record yet means nothing has been narrowed down: every kind of care is on.
          offered: avail ? Boolean(avail[CARE_TYPE_COLUMNS[p.careType]]) : true,
          pricing: p,
          amount,
          clientPrice: amount === null ? null : clientPriceFor(amount, p.feePercent),
          outOfBand: amount !== null && p.enabled && (amount < p.minRate || amount > p.maxRate),
          updatedAt: rate?.updatedAt?.toISOString() ?? null,
        };
      }),
    };
  }

  /** Sets or removes rates for the care types sent; the others are left as they are. */
  async setRates(caregiverId: string, dto: UpdateCaregiverRatesDto, userId: string): Promise<CaregiverRateCard> {
    await this.caregiverOrThrow(caregiverId);
    const pricing = await this.pricing();
    const seen = new Set<CareType>();
    for (const entry of dto.rates) {
      if (seen.has(entry.careType)) throw new BadRequestException('Each kind of care can be given only once');
      seen.add(entry.careType);
      if (entry.amount === null) continue;
      const p = pricing.find((x) => x.careType === entry.careType)!;
      const problem = rateProblem(entry.amount, p);
      if (problem === 'DISABLED') throw new BadRequestException('Rates for this kind of care are set by the office');
      if (problem === 'NOT_A_NUMBER') throw new BadRequestException('Enter a rate above zero');
      if (problem === 'TOO_LOW') throw new BadRequestException('The rate is below the lowest allowed for this kind of care');
      if (problem === 'TOO_HIGH') throw new BadRequestException('The rate is above the highest allowed for this kind of care');
    }
    await this.db.transaction(async (tx) => {
      for (const entry of dto.rates) {
        if (entry.amount === null) {
          await tx.delete(caregiverRates).where(and(eq(caregiverRates.caregiverId, caregiverId), eq(caregiverRates.careType, entry.careType)));
        } else {
          await tx
            .insert(caregiverRates)
            .values({ id: uuid(), caregiverId, careType: entry.careType, amount: entry.amount, updatedBy: userId })
            .onDuplicateKeyUpdate({ set: { amount: entry.amount, updatedBy: userId, updatedAt: new Date() } });
        }
      }
    });
    return this.rateCard(caregiverId);
  }

  /**
   * What a booking with this caregiver for this kind of care is priced at, or
   * null when there is nothing to go on: own rates are off for the care type,
   * the caregiver has not set one, or theirs now falls outside the band.
   * Null always means "price it by hand", never "free".
   */
  async quote(caregiverId: string, careType: CareType): Promise<RateQuote | null> {
    const line = (await this.rateCard(caregiverId)).lines.find((l) => l.careType === careType)!;
    if (!line.pricing.enabled || line.amount === null || line.outOfBand) return null;
    return { careType, rateType: line.pricing.rateType, payRate: line.amount, feePercent: line.pricing.feePercent, clientRate: line.clientPrice! };
  }
}
