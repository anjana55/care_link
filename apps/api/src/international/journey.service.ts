import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { departureItemValues, type DepartureChecklistItem, type DepartureItem, type PlacementJourney } from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import { jobOffers, placementChecklistItems, placements } from '../database/schema';
import { ContactAbroadDto, UpdateChecklistItemDto } from './dto/phase4.dto';
import { todayColombo } from './dates';

type ItemRow = typeof placementChecklistItems.$inferSelect;
type PlacementRow = typeof placements.$inferSelect;

/** The checklist in its fixed order, filling in items that have no row yet. */
export function checklistOf(rows: Pick<ItemRow, 'item' | 'doneOn' | 'dueOn' | 'note'>[]): DepartureChecklistItem[] {
  const by = new Map(rows.map((r) => [r.item, r]));
  return departureItemValues.map((item) => {
    const r = by.get(item);
    return { item, done: !!r?.doneOn, doneOn: r?.doneOn ?? null, dueOn: r?.dueOn ?? null, note: r?.note ?? null };
  });
}

/**
 * Getting a hired caregiver from Sri Lanka to their job: the pre-departure
 * checklist staff work through, the flight details, and where the caregiver
 * is once there. The caregiver sees all of it and keeps their address and
 * phone abroad up to date; the employer sees none of it.
 */
@Injectable()
export class JourneyService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async forPlacements(rows: Pick<PlacementRow, 'id' | 'departureDetails' | 'addressAbroad' | 'phoneAbroad' | 'candidateId'>[]): Promise<Map<string, PlacementJourney>> {
    const out = new Map<string, PlacementJourney>();
    if (!rows.length) return out;
    const ids = rows.map((r) => r.id);
    const [items, accepted] = await Promise.all([
      this.db.select().from(placementChecklistItems).where(inArray(placementChecklistItems.placementId, ids)),
      this.db
        .select({ candidateId: jobOffers.candidateId, respondedAt: jobOffers.respondedAt })
        .from(jobOffers)
        .where(and(inArray(jobOffers.candidateId, rows.map((r) => r.candidateId)), eq(jobOffers.status, 'ACCEPTED'))),
    ]);
    const acceptedOn = new Map(accepted.map((a) => [a.candidateId, a.respondedAt ? new Date(a.respondedAt).toISOString().slice(0, 10) : todayColombo()]));
    for (const p of rows) {
      const own = items.filter((i) => i.placementId === p.id);
      const checklist = checklistOf(own);
      // An offer accepted on the platform ticks its own box, unless staff have said otherwise.
      const offer = checklist.find((c) => c.item === 'OFFER_ACCEPTED')!;
      if (!offer.done && !own.some((i) => i.item === 'OFFER_ACCEPTED') && acceptedOn.has(p.candidateId)) {
        offer.done = true;
        offer.doneOn = acceptedOn.get(p.candidateId)!;
      }
      out.set(p.id, { checklist, departureDetails: p.departureDetails, addressAbroad: p.addressAbroad, phoneAbroad: p.phoneAbroad });
    }
    return out;
  }

  async updateItem(placementId: string, item: DepartureItem, dto: UpdateChecklistItemDto, userId: string): Promise<void> {
    await this.placement(placementId);
    const [existing] = await this.db
      .select()
      .from(placementChecklistItems)
      .where(and(eq(placementChecklistItems.placementId, placementId), eq(placementChecklistItems.item, item)))
      .limit(1);
    const doneOn = dto.done === false ? null : dto.done === true ? (dto.doneOn ?? existing?.doneOn ?? todayColombo()) : dto.doneOn !== undefined ? dto.doneOn : (existing?.doneOn ?? null);
    if (doneOn && doneOn > todayColombo()) throw new BadRequestException('A step cannot be done in the future.');
    const values = {
      doneOn,
      dueOn: dto.dueOn !== undefined ? dto.dueOn : (existing?.dueOn ?? null),
      note: dto.note !== undefined ? dto.note : (existing?.note ?? null),
      updatedByUserId: userId,
      updatedAt: new Date(),
    };
    if (existing) {
      await this.db
        .update(placementChecklistItems)
        .set(values)
        .where(and(eq(placementChecklistItems.placementId, placementId), eq(placementChecklistItems.item, item)));
    } else {
      await this.db.insert(placementChecklistItems).values({ placementId, item, ...values });
    }
  }

  /** The caregiver's own placement only, and only while it is running. */
  async updateContact(caregiverId: string, placementId: string, dto: ContactAbroadDto): Promise<void> {
    const p = await this.placement(placementId);
    if (p.caregiverId !== caregiverId) throw new NotFoundException('Placement not found');
    if (p.status !== 'PRE_DEPARTURE' && p.status !== 'DEPLOYED') throw new BadRequestException('This placement has ended.');
    await this.db
      .update(placements)
      .set({
        ...(dto.addressAbroad !== undefined ? { addressAbroad: dto.addressAbroad } : {}),
        ...(dto.phoneAbroad !== undefined ? { phoneAbroad: dto.phoneAbroad } : {}),
        updatedAt: new Date(),
      })
      .where(eq(placements.id, placementId));
  }

  private async placement(id: string): Promise<PlacementRow> {
    const [row] = await this.db.select().from(placements).where(eq(placements.id, id)).limit(1);
    if (!row) throw new NotFoundException('Placement not found');
    return row;
  }
}
