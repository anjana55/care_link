import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID as uuid } from 'crypto';
import { and, asc, count, desc, eq, inArray, isNull, lt } from 'drizzle-orm';
import {
  CHECKIN_DAYS_AFTER_ARRIVAL,
  DEFAULT_GUARANTEE_MONTHS,
  checkinKindValues,
  type CaregiverPlacement,
  type EmployerPlacement,
  type PlacementCheckin,
  type PlacementStatus,
  type StaffPlacement,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  caregivers,
  employerEnquiries,
  enquiryCandidates,
  overseasVacancies,
  placementCheckins,
  placements,
  sharedProfiles,
  vacancyApplications,
} from '../database/schema';
import { PlacementQueryDto, UpdateCheckinDto, UpdatePlacementDto } from './dto/phase3.dto';
import { PlacementInvoicesService } from './placement-invoices.service';
import { SharedProfilesService } from './shared-profiles.service';
import { InternationalNotifier } from './international-notifier.service';
import { iso } from './employer-enquiries.service';
import { addDays, addMonths, todayColombo } from './dates';
import { JourneyService } from './journey.service';
import { OffersService } from './offers.service';
import { WelfareService } from './welfare.service';

type PlacementRow = typeof placements.$inferSelect;
type CheckinRow = typeof placementCheckins.$inferSelect;

export const ACTIVE_PLACEMENT_STATUSES: PlacementStatus[] = ['PRE_DEPARTURE', 'DEPLOYED'];

/** When the contract ends, if both its start and length are known. */
export function contractEndsOn(p: Pick<PlacementRow, 'contractStartOn' | 'contractMonths'>): string | null {
  return p.contractStartOn && p.contractMonths ? addMonths(p.contractStartOn, p.contractMonths) : null;
}

/** Until when an early end earns the employer a free replacement: from the contract start, else arrival. */
export function guaranteeEndsOn(p: Pick<PlacementRow, 'contractStartOn' | 'arrivedOn' | 'guaranteeMonths'>): string | null {
  const from = p.contractStartOn ?? p.arrivedOn;
  return from && p.guaranteeMonths > 0 ? addMonths(from, p.guaranteeMonths) : null;
}

/** The welfare check-ins for an arrival date. */
export function checkinSchedule(arrivedOn: string): { kind: (typeof checkinKindValues)[number]; dueOn: string }[] {
  return checkinKindValues.map((kind) => ({ kind, dueOn: addDays(arrivedOn, CHECKIN_DAYS_AFTER_ARRIVAL[kind]) }));
}

/**
 * Checks a placement change makes sense before it is saved. Returns the
 * values to store on top of the change (an end date filled in, say).
 */
export function checkPlacementChange(current: PlacementRow, next: PlacementRow, today = todayColombo()): Partial<PlacementRow> {
  const extra: Partial<PlacementRow> = {};
  if (next.departureOn && next.arrivedOn && next.arrivedOn < next.departureOn) throw new BadRequestException('Arrival cannot be before departure.');
  if (next.status === 'DEPLOYED' && !next.arrivedOn) throw new BadRequestException('Give the arrival date to mark the caregiver as working.');
  if (next.status === 'ENDED_EARLY') {
    if (!next.endReason) throw new BadRequestException('Say why the placement ended early.');
    if (!next.endedOn) extra.endedOn = today;
  }
  if (next.status === 'COMPLETED' && !next.endedOn) extra.endedOn = contractEndsOn(next) ?? today;
  if ((next.status === 'PRE_DEPARTURE' || next.status === 'DEPLOYED') && current.status !== next.status && (current.status === 'COMPLETED' || current.status === 'ENDED_EARLY')) {
    // Reopened: the end no longer applies.
    extra.endedOn = null;
    extra.endReason = null;
  }
  return extra;
}

/**
 * A caregiver hired through the platform, tracked from hire to contract end:
 * travel and arrival, welfare check-ins at set points after arrival, how it
 * ended, and the replacement guarantee. The employer sees their own
 * placements (by first name); the caregiver sees their own (never the
 * employer's name - staff are their contact).
 */
@Injectable()
export class PlacementsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly invoices: PlacementInvoicesService,
    private readonly sharedProfiles: SharedProfilesService,
    private readonly notifier: InternationalNotifier,
    private readonly journey: JourneyService,
    private readonly offers: OffersService,
    private readonly welfare: WelfareService,
  ) {}

  /** Called when staff mark a candidate Placed. Idempotent: one placement per candidate. */
  async openForCandidate(candidateId: string, userId: string | null): Promise<string> {
    const [existing] = await this.db.select({ id: placements.id }).from(placements).where(eq(placements.candidateId, candidateId)).limit(1);
    if (existing) return existing.id;
    const [row] = await this.db
      .select({ c: enquiryCandidates, e: employerEnquiries })
      .from(enquiryCandidates)
      .innerJoin(employerEnquiries, eq(enquiryCandidates.enquiryId, employerEnquiries.id))
      .where(eq(enquiryCandidates.id, candidateId))
      .limit(1);
    if (!row) throw new NotFoundException('Candidate not found');
    // Hired from a vacancy: its title is the job.
    const [fromVacancy] = await this.db
      .select({ title: overseasVacancies.title, contractMonths: overseasVacancies.contractMonths })
      .from(vacancyApplications)
      .innerJoin(overseasVacancies, eq(vacancyApplications.vacancyId, overseasVacancies.id))
      .where(eq(vacancyApplications.candidateId, candidateId))
      .limit(1);
    // An offer the caregiver accepted on the platform: its terms are the job.
    const offer = await this.offers.acceptedFor(candidateId);
    const id = uuid();
    await this.db.insert(placements).values({
      id,
      candidateId,
      enquiryId: row.e.id,
      caregiverId: row.c.caregiverId,
      employerId: row.e.employerId,
      country: row.e.country,
      jobTitle: offer?.jobTitle ?? fromVacancy?.title ?? null,
      contractMonths: offer?.contractMonths ?? fromVacancy?.contractMonths ?? null,
      contractStartOn: offer?.startDate ?? null,
      guaranteeMonths: DEFAULT_GUARANTEE_MONTHS,
      feeAmount: row.e.placementFeeAmount,
      feeCurrency: row.e.placementFeeCurrency,
      createdByUserId: userId,
    });
    return id;
  }

  // --- staff ----------------------------------------------------------------------

  async staffList(query: PlacementQueryDto): Promise<StaffPlacement[]> {
    const where =
      query.status === 'active' ? inArray(placements.status, ACTIVE_PLACEMENT_STATUSES) : query.status ? eq(placements.status, query.status) : undefined;
    const rows = await this.select().where(where).orderBy(desc(placements.createdAt)).limit(300);
    return this.toStaff(rows);
  }

  async staffGet(id: string): Promise<StaffPlacement> {
    const rows = await this.select().where(eq(placements.id, id)).limit(1);
    if (!rows.length) throw new NotFoundException('Placement not found');
    return (await this.toStaff(rows))[0];
  }

  async update(id: string, dto: UpdatePlacementDto): Promise<StaffPlacement> {
    const current = await this.row(id);
    const changes: Partial<PlacementRow> = {};
    for (const key of [
      'jobTitle',
      'departureDetails',
      'addressAbroad',
      'phoneAbroad',
      'status',
      'departureOn',
      'arrivedOn',
      'contractStartOn',
      'contractMonths',
      'endedOn',
      'endReason',
      'guaranteeMonths',
      'feeAmount',
      'feeCurrency',
      'staffNote',
    ] as const) {
      if (dto[key] !== undefined) (changes as Record<string, unknown>)[key] = dto[key];
    }
    const next = { ...current, ...changes } as PlacementRow;
    Object.assign(changes, checkPlacementChange(current, next));
    await this.db.update(placements).set({ ...changes, updatedAt: new Date() }).where(eq(placements.id, id));

    const arrived = changes.arrivedOn !== undefined ? changes.arrivedOn : current.arrivedOn;
    if (arrived && arrived !== current.arrivedOn) await this.schedule(id, arrived);

    const ended = { ...next, ...changes } as PlacementRow;
    if (ended.status === 'ENDED_EARLY' && current.status !== 'ENDED_EARLY') {
      const until = guaranteeEndsOn(ended);
      if (until && ended.endedOn && ended.endedOn <= until) void this.notifyReplacementDue(ended, until);
    }
    return this.staffGet(id);
  }

  async updateCheckin(placementId: string, checkinId: string, dto: UpdateCheckinDto, userId: string): Promise<StaffPlacement> {
    const [c] = await this.db
      .select()
      .from(placementCheckins)
      .where(and(eq(placementCheckins.id, checkinId), eq(placementCheckins.placementId, placementId)))
      .limit(1);
    if (!c) throw new NotFoundException('Check-in not found');
    if (dto.completedOn && !dto.outcome && !c.outcome) throw new BadRequestException('Record how the caregiver is doing.');
    await this.db
      .update(placementCheckins)
      .set({
        completedOn: dto.completedOn,
        ...(dto.outcome !== undefined ? { outcome: dto.outcome } : {}),
        ...(dto.note !== undefined ? { note: dto.note } : {}),
        recordedByUserId: userId,
        updatedAt: new Date(),
      })
      .where(eq(placementCheckins.id, checkinId));
    if (dto.outcome === 'URGENT' && c.outcome !== 'URGENT') void this.notifyUrgent(placementId, dto.note ?? null);
    return this.staffGet(placementId);
  }

  /** Check-ins past due on placements still running. */
  async overdueCheckins(today = todayColombo()) {
    return this.db
      .select({
        placementId: placements.id,
        kind: placementCheckins.kind,
        dueOn: placementCheckins.dueOn,
        fullName: caregivers.fullName,
        country: placements.country,
      })
      .from(placementCheckins)
      .innerJoin(placements, eq(placementCheckins.placementId, placements.id))
      .innerJoin(caregivers, eq(placements.caregiverId, caregivers.id))
      .where(and(isNull(placementCheckins.completedOn), lt(placementCheckins.dueOn, today), inArray(placements.status, ACTIVE_PLACEMENT_STATUSES)))
      .orderBy(asc(placementCheckins.dueOn))
      .limit(200);
  }

  async overdueCheckinCount(today = todayColombo()): Promise<number> {
    const [{ n }] = await this.db
      .select({ n: count() })
      .from(placementCheckins)
      .innerJoin(placements, eq(placementCheckins.placementId, placements.id))
      .where(and(isNull(placementCheckins.completedOn), lt(placementCheckins.dueOn, today), inArray(placements.status, ACTIVE_PLACEMENT_STATUSES)));
    return Number(n);
  }

  // --- the employer and the caregiver ------------------------------------------------

  async forEmployer(employerId: string, locale?: string): Promise<EmployerPlacement[]> {
    const rows = await this.db
      .select({ p: placements, reference: employerEnquiries.reference, firstName: sharedProfiles.firstName })
      .from(placements)
      .innerJoin(employerEnquiries, eq(placements.enquiryId, employerEnquiries.id))
      .leftJoin(sharedProfiles, eq(sharedProfiles.caregiverId, placements.caregiverId))
      .where(eq(placements.employerId, employerId))
      .orderBy(desc(placements.createdAt))
      .limit(100);
    if (!rows.length) return [];
    const [cards, invoices] = await Promise.all([
      this.sharedProfiles.liveCards(
        rows.map((r) => r.p.caregiverId),
        locale,
      ),
      this.invoices.summariesForPlacements(
        rows.map((r) => r.p.id),
        { includeDrafts: false },
      ),
    ]);
    return rows.map(({ p, reference, firstName }) => {
      const card = cards.get(p.caregiverId);
      return {
        id: p.id,
        enquiryReference: reference,
        // The employer hired them, so their first name stays even if they stop sharing; the photo does not.
        talent: { firstName: card?.firstName ?? firstName ?? '-', slug: card?.slug ?? null, photoUrl: card?.photoUrl ?? null },
        country: p.country,
        jobTitle: p.jobTitle,
        status: p.status,
        departureOn: p.departureOn,
        arrivedOn: p.arrivedOn,
        contractStartOn: p.contractStartOn,
        contractEndsOn: contractEndsOn(p),
        guaranteeEndsOn: guaranteeEndsOn(p),
        invoices: invoices.get(p.id) ?? [],
      };
    });
  }

  async forCaregiver(caregiverId: string): Promise<CaregiverPlacement[]> {
    const rows = await this.db
      .select({ p: placements, organisationType: employerEnquiries.organisationType })
      .from(placements)
      .innerJoin(employerEnquiries, eq(placements.enquiryId, employerEnquiries.id))
      .where(eq(placements.caregiverId, caregiverId))
      .orderBy(desc(placements.createdAt))
      .limit(20);
    const journeys = await this.journey.forPlacements(rows.map((r) => r.p));
    return rows.map(({ p, organisationType }) => ({
      journey: journeys.get(p.id)!,
      id: p.id,
      country: p.country,
      organisationType,
      jobTitle: p.jobTitle,
      status: p.status,
      departureOn: p.departureOn,
      arrivedOn: p.arrivedOn,
      contractStartOn: p.contractStartOn,
      contractEndsOn: contractEndsOn(p),
    }));
  }

  /** Caregivers in a running placement - their documents matter most. */
  async activeCaregiverIds(): Promise<Set<string>> {
    const rows = await this.db.selectDistinct({ id: placements.caregiverId }).from(placements).where(inArray(placements.status, ACTIVE_PLACEMENT_STATUSES));
    return new Set(rows.map((r) => r.id));
  }

  // --- internals --------------------------------------------------------------------------

  /** Creates the check-ins for an arrival date, or moves the ones not yet done to match a corrected date. */
  private async schedule(placementId: string, arrivedOn: string) {
    const existing = await this.db.select().from(placementCheckins).where(eq(placementCheckins.placementId, placementId));
    const byKind = new Map(existing.map((c) => [c.kind, c]));
    for (const { kind, dueOn } of checkinSchedule(arrivedOn)) {
      const c = byKind.get(kind);
      if (!c) await this.db.insert(placementCheckins).values({ id: uuid(), placementId, kind, dueOn });
      else if (!c.completedOn && c.dueOn !== dueOn) await this.db.update(placementCheckins).set({ dueOn, updatedAt: new Date() }).where(eq(placementCheckins.id, c.id));
    }
  }

  private select() {
    return this.db
      .select({
        p: placements,
        reference: employerEnquiries.reference,
        organisationName: employerEnquiries.organisationName,
        registrationNumber: caregivers.registrationNumber,
        fullName: caregivers.fullName,
      })
      .from(placements)
      .innerJoin(employerEnquiries, eq(placements.enquiryId, employerEnquiries.id))
      .innerJoin(caregivers, eq(placements.caregiverId, caregivers.id))
      .$dynamic();
  }

  private async toStaff(rows: { p: PlacementRow; reference: string; organisationName: string; registrationNumber: string; fullName: string }[]): Promise<StaffPlacement[]> {
    const ids = rows.map((r) => r.p.id);
    if (!ids.length) return [];
    const [checkins, invoices, journeys, welfare] = await Promise.all([
      this.db.select().from(placementCheckins).where(inArray(placementCheckins.placementId, ids)).orderBy(asc(placementCheckins.dueOn)),
      this.invoices.summariesForPlacements(ids, { includeDrafts: true }),
      this.journey.forPlacements(rows.map((r) => r.p)),
      this.welfare.unresolvedByPlacement(ids),
    ]);
    return rows.map(({ p, reference, organisationName, registrationNumber, fullName }) => {
      const own = checkins.filter((c) => c.placementId === p.id).map(toCheckin);
      return {
        id: p.id,
        candidateId: p.candidateId,
        enquiryId: p.enquiryId,
        enquiryReference: reference,
        organisationName,
        employerId: p.employerId,
        caregiverId: p.caregiverId,
        registrationNumber,
        fullName,
        country: p.country,
        jobTitle: p.jobTitle,
        status: p.status,
        departureOn: p.departureOn,
        arrivedOn: p.arrivedOn,
        contractStartOn: p.contractStartOn,
        contractMonths: p.contractMonths,
        contractEndsOn: contractEndsOn(p),
        endedOn: p.endedOn,
        endReason: p.endReason,
        guaranteeMonths: p.guaranteeMonths,
        guaranteeEndsOn: guaranteeEndsOn(p),
        feeAmount: p.feeAmount,
        feeCurrency: p.feeCurrency,
        staffNote: p.staffNote,
        checkins: own,
        nextCheckin: ACTIVE_PLACEMENT_STATUSES.includes(p.status) ? (own.find((c) => !c.completedOn) ?? null) : null,
        journey: journeys.get(p.id)!,
        openWelfareReports: welfare.get(p.id) ?? 0,
        invoices: invoices.get(p.id) ?? [],
        createdAt: iso(p.createdAt),
        updatedAt: iso(p.updatedAt),
      };
    });
  }

  private async row(id: string): Promise<PlacementRow> {
    const [row] = await this.db.select().from(placements).where(eq(placements.id, id)).limit(1);
    if (!row) throw new NotFoundException('Placement not found');
    return row;
  }

  private async notifyReplacementDue(p: PlacementRow, until: string) {
    await this.notifier.toStaff(`placement ended early ${p.id}`, {
      subject: 'A placement ended inside its guarantee period',
      paragraphs: [`A placement in ${p.country} ended on ${p.endedOn}, before its replacement guarantee ran out (${until}).`, 'The employer is owed a replacement caregiver without a second placement fee.'],
      cta: { label: 'Open placement', url: this.notifier.staffUrl(`/international/placements/${p.id}`) },
    });
  }

  private async notifyUrgent(placementId: string, note: string | null) {
    await this.notifier.toStaff(`urgent check-in ${placementId}`, {
      subject: 'URGENT: a caregiver abroad needs help',
      paragraphs: ['A welfare check-in was recorded as urgent.', ...(note ? [`Note: ${note}`] : []), 'Open the placement and follow up today.'],
      cta: { label: 'Open placement', url: this.notifier.staffUrl(`/international/placements/${placementId}`) },
    });
  }
}

function toCheckin(c: CheckinRow): PlacementCheckin {
  return { id: c.id, kind: c.kind, dueOn: c.dueOn, completedOn: c.completedOn, outcome: c.outcome, note: c.note };
}
