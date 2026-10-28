import { Inject, Injectable } from '@nestjs/common';
import { and, count, eq, gte, inArray, isNotNull, isNull, lt, lte, ne, sql, type SQL } from 'drizzle-orm';
import type { AnyMySqlColumn } from 'drizzle-orm/mysql-core';
import {
  addDays,
  colomboToUtc,
  colomboToday,
  resolveLocale,
  type BusinessInsights,
  type InsightAgingBucket,
  type InsightDistrictRow,
  type InsightRange,
  type Locale,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  bookingShifts,
  bookings,
  careRequestEvents,
  careRequests,
  caregiverDocuments,
  caregiverStatusEnum,
  caregivers,
  districts,
  invoicePayments,
  invoices,
  patients,
  payoutStatements,
} from '../database/schema';
import { fold, median, periodFor, ratio, round2, type DailyValue } from './periods';
import { CarePlansService } from '../care-plans/care-plans.service';

/** A UTC datetime column as its Asia/Colombo calendar day (Sri Lanka has no DST). */
const colomboDay = (col: AnyMySqlColumn | SQL) => sql<string>`DATE_FORMAT(DATE_ADD(${col}, INTERVAL 330 MINUTE), '%Y-%m-%d')`;
/** A DATE column as YYYY-MM-DD text, whatever the driver would otherwise hand back. */
const dayText = (col: AnyMySqlColumn) => sql<string>`DATE_FORMAT(${col}, '%Y-%m-%d')`;
/**
 * One completed shift's value at either the client rate (`rate`) or the
 * caregiver pay rate (`pay_rate`): the shift's own rate when set, else its
 * booking's. NULL when neither has one. Expects booking_shifts joined to bookings.
 */
const shiftValue = (kind: 'rate' | 'pay_rate') => {
  const s = (c: string) => sql.raw(`booking_shifts.${kind}_${c}`);
  const b = (c: string) => sql.raw(`bookings.${kind}_${c}`);
  const hours = sql`TIMESTAMPDIFF(MINUTE, booking_shifts.starts_at, booking_shifts.ends_at) / 60`;
  return sql`CASE
    WHEN ${s('amount')} IS NOT NULL THEN IF(${s('type')} = 'HOURLY', ${s('amount')} * ${hours}, ${s('amount')})
    WHEN ${b('amount')} IS NOT NULL THEN CASE ${b('type')}
      WHEN 'HOURLY' THEN ${b('amount')} * ${hours}
      WHEN 'DAILY' THEN ${b('amount')}
      WHEN 'MONTHLY' THEN ${b('amount')} / 30
    END
  END`;
};
const num = (v: unknown) => (v === null || v === undefined ? 0 : Number(v));

const AGING_KEYS: InsightAgingBucket['key'][] = ['current', 'd1_30', 'd31_60', 'd61_90', 'd90_plus'];

/**
 * The staff dashboard's business vital signs. Read-only aggregates over the
 * operational tables - nothing here is stored, so the numbers can never drift
 * from the records they summarise.
 *
 * Time-series measures are read as one row per day across the previous and
 * current periods together, then folded into buckets in code (see periods.ts),
 * so each measure costs one grouped query whatever the range.
 */
@Injectable()
export class InsightsService {
  constructor(
    @Inject(DRIZZLE) private readonly db: Database,
    private readonly carePlans: CarePlansService,
  ) {}

  async overview(range: InsightRange, localeInput?: string): Promise<BusinessInsights> {
    const locale = resolveLocale(localeInput);
    const today = colomboToday();
    const p = periodFor(range, today);

    // Datetime bounds (UTC instants) for the whole span and for the current period.
    const spanStart = colomboToUtc(p.prevFrom, '00:00');
    const periodStart = colomboToUtc(p.from, '00:00');
    const periodEnd = colomboToUtc(addDays(p.to, 1), '00:00');

    const [
      invoicedRows,
      collectedRows,
      economicsRows,
      requestRows,
      placementRows,
      shiftRows,
      clientRows,
      caregiverRows,
    ] = await Promise.all([
      this.db
        .select({ day: dayText(invoices.issueDate), total: sql<string>`SUM(${invoices.total})` })
        .from(invoices)
        .where(and(inArray(invoices.status, ['ISSUED', 'PAID']), gte(invoices.issueDate, p.prevFrom), lte(invoices.issueDate, p.to)))
        .groupBy(sql`1`),
      this.db
        .select({ day: dayText(invoicePayments.paidOn), total: sql<string>`SUM(${invoicePayments.amount})` })
        .from(invoicePayments)
        .where(and(gte(invoicePayments.paidOn, p.prevFrom), lte(invoicePayments.paidOn, p.to)))
        .groupBy(sql`1`),
      // Earned economics of completed shifts: what the client is charged and
      // what the caregiver is paid for each, from the shift's own rate or else
      // its booking's. A monthly rate counts as a 30th per day worked. Shifts
      // with no rate are left out of both sides rather than counted as free.
      this.db
        .select({
          day: colomboDay(bookingShifts.startsAt),
          revenue: sql<string>`SUM(${shiftValue('rate')})`,
          cost: sql<string>`SUM(${shiftValue('pay_rate')})`,
        })
        .from(bookingShifts)
        .innerJoin(bookings, eq(bookings.id, bookingShifts.bookingId))
        .where(
          and(
            eq(bookingShifts.status, 'COMPLETED'),
            gte(bookingShifts.startsAt, spanStart),
            lt(bookingShifts.startsAt, periodEnd),
            sql`${shiftValue('rate')} IS NOT NULL`,
            sql`${shiftValue('pay_rate')} IS NOT NULL`,
          ),
        )
        .groupBy(sql`1`),
      this.db
        .select({ day: colomboDay(careRequests.createdAt), n: count() })
        .from(careRequests)
        .where(and(gte(careRequests.createdAt, spanStart), lt(careRequests.createdAt, periodEnd)))
        .groupBy(sql`1`),
      this.db
        .select({ day: colomboDay(bookings.confirmedAt), n: count() })
        .from(bookings)
        .where(and(isNotNull(bookings.confirmedAt), gte(bookings.confirmedAt, spanStart), lt(bookings.confirmedAt, periodEnd)))
        .groupBy(sql`1`),
      this.db
        .select({
          day: colomboDay(bookingShifts.startsAt),
          status: bookingShifts.status,
          n: count(),
          minutes: sql<string>`SUM(TIMESTAMPDIFF(MINUTE, ${bookingShifts.startsAt}, ${bookingShifts.endsAt}))`,
        })
        .from(bookingShifts)
        .where(and(inArray(bookingShifts.status, ['COMPLETED', 'MISSED']), gte(bookingShifts.startsAt, spanStart), lt(bookingShifts.startsAt, periodEnd)))
        .groupBy(sql`1`, bookingShifts.status),
      this.db
        .select({ day: colomboDay(patients.createdAt), n: count() })
        .from(patients)
        .where(and(gte(patients.createdAt, spanStart), lt(patients.createdAt, periodEnd)))
        .groupBy(sql`1`),
      this.db
        .select({ day: colomboDay(caregivers.createdAt), n: count() })
        .from(caregivers)
        .where(and(isNull(caregivers.deletedAt), gte(caregivers.createdAt, spanStart), lt(caregivers.createdAt, periodEnd)))
        .groupBy(sql`1`),
    ]);

    const daily = <T>(rows: T[], pick: (r: T) => number, day: (r: T) => string) =>
      rows.map((r): DailyValue => ({ day: day(r), value: pick(r) }));

    const invoiced = fold(p, daily(invoicedRows, (r) => num(r.total), (r) => r.day));
    const collected = fold(p, daily(collectedRows, (r) => num(r.total), (r) => r.day));
    const earned = fold(p, daily(economicsRows, (r) => num(r.revenue), (r) => r.day));
    const cost = fold(p, daily(economicsRows, (r) => num(r.cost), (r) => r.day));
    const requests = fold(p, daily(requestRows, (r) => num(r.n), (r) => r.day));
    const placements = fold(p, daily(placementRows, (r) => num(r.n), (r) => r.day));
    const completed = shiftRows.filter((r) => r.status === 'COMPLETED');
    const missed = shiftRows.filter((r) => r.status === 'MISSED');
    const careHours = fold(p, daily(completed, (r) => num(r.minutes) / 60, (r) => r.day));
    const completedCount = fold(p, daily(completed, (r) => num(r.n), (r) => r.day));
    const missedCount = fold(p, daily(missed, (r) => num(r.n), (r) => r.day));
    const newClients = fold(p, daily(clientRows, (r) => num(r.n), (r) => r.day));
    const newCaregivers = fold(p, daily(caregiverRows, (r) => num(r.n), (r) => r.day));

    const [requestsBlock, pipeline, aging, upcoming, demandSupply, topCaregivers, now, attention] = await Promise.all([
      this.requestInsights(periodStart, periodEnd),
      this.caregiverPipeline(),
      this.receivablesAging(today),
      this.upcomingShifts(today),
      this.demandSupply(locale, periodStart, periodEnd),
      this.topCaregivers(periodStart, periodEnd),
      this.rightNow(today),
      this.attention(today),
    ]);

    const margin = round2(earned.total - cost.total);
    const marginPrev = round2(earned.previous - cost.previous);

    return {
      range,
      from: p.from,
      to: p.to,
      generatedAt: new Date().toISOString(),
      bucketUnit: p.unit,
      buckets: p.buckets,
      kpis: {
        invoiced: { value: invoiced.total, previous: invoiced.previous },
        collected: { value: collected.total, previous: collected.previous },
        grossMargin: { value: margin, previous: marginPrev },
        newRequests: { value: requests.total, previous: requests.previous },
        placements: { value: placements.total, previous: placements.previous },
        careHours: { value: careHours.total, previous: careHours.previous },
        newClients: { value: newClients.total, previous: newClients.previous },
        newCaregivers: { value: newCaregivers.total, previous: newCaregivers.previous },
        activeCaregivers: now.activeCaregivers,
        activeClients: now.activeClients,
      },
      series: {
        invoiced: invoiced.series,
        collected: collected.series,
        requests: requests.series,
        placements: placements.series,
        careHours: careHours.series,
      },
      dials: {
        conversion: ratio(requestsBlock.funnel.booked, requestsBlock.funnel.created),
        collection: ratio(collected.total, invoiced.total),
        utilization: ratio(now.workingCaregivers, now.activeCaregivers),
        attendance: ratio(completedCount.total, completedCount.total + missedCount.total),
        margin: ratio(margin, earned.total),
      },
      requests: requestsBlock,
      caregiverPipeline: pipeline,
      receivablesAging: aging,
      upcomingShifts: upcoming,
      demandSupply,
      topCaregivers,
      attention,
    };
  }

  // --- care requests -------------------------------------------------------------

  private async requestInsights(periodStart: Date, periodEnd: Date): Promise<BusinessInsights['requests']> {
    const inPeriod = and(gte(careRequests.createdAt, periodStart), lt(careRequests.createdAt, periodEnd));
    // A request counts as booked if a booking that actually went ahead came
    // from it, or staff closed it as placed (placements arranged off-system).
    const booked = sql<number>`(EXISTS (SELECT 1 FROM ${bookings} b WHERE b.care_request_id = ${careRequests.id} AND b.status IN ('CONFIRMED','COMPLETED')) OR ${careRequests.closeReason} = 'PLACED')`;
    const introduced = sql<number>`(${careRequests.status} = 'INTRODUCED' OR EXISTS (SELECT 1 FROM ${careRequestEvents} e WHERE e.request_id = ${careRequests.id} AND e.to_status = 'INTRODUCED'))`;

    const [[funnel], open, reasons, sources, firstActions] = await Promise.all([
      this.db
        .select({
          created: count(),
          contacted: sql<string>`SUM(CASE WHEN ${careRequests.status} <> 'NEW' OR ${booked} THEN 1 ELSE 0 END)`,
          introduced: sql<string>`SUM(CASE WHEN ${introduced} OR ${booked} THEN 1 ELSE 0 END)`,
          booked: sql<string>`SUM(CASE WHEN ${booked} THEN 1 ELSE 0 END)`,
        })
        .from(careRequests)
        .where(inPeriod),
      this.db
        .select({ status: careRequests.status, n: count() })
        .from(careRequests)
        .where(inArray(careRequests.status, ['NEW', 'IN_PROGRESS', 'INTRODUCED']))
        .groupBy(careRequests.status),
      this.db
        .select({ key: careRequests.closeReason, n: count() })
        .from(careRequests)
        .where(and(isNotNull(careRequests.closeReason), gte(careRequests.closedAt, periodStart), lt(careRequests.closedAt, periodEnd)))
        .groupBy(careRequests.closeReason),
      this.db.select({ source: careRequests.source, n: count() }).from(careRequests).where(inPeriod).groupBy(careRequests.source),
      this.db
        .select({
          minutes: sql<string>`TIMESTAMPDIFF(MINUTE, ${careRequests.createdAt}, MIN(${careRequestEvents.createdAt}))`,
        })
        .from(careRequests)
        .innerJoin(careRequestEvents, and(eq(careRequestEvents.requestId, careRequests.id), ne(careRequestEvents.type, 'CREATED')))
        .where(inPeriod)
        .groupBy(careRequests.id, careRequests.createdAt),
    ]);

    const openBy = { NEW: 0, IN_PROGRESS: 0, INTRODUCED: 0 };
    for (const r of open) if (r.status in openBy) openBy[r.status as keyof typeof openBy] = num(r.n);
    const sourceBy = { WEB: 0, PHONE: 0 };
    for (const r of sources) sourceBy[r.source] = num(r.n);
    const hours = median(firstActions.map((r) => Math.max(0, num(r.minutes)) / 60));

    return {
      funnel: {
        created: num(funnel?.created),
        contacted: num(funnel?.contacted),
        introduced: num(funnel?.introduced),
        booked: num(funnel?.booked),
      },
      open: openBy,
      closeReasons: reasons
        .map((r) => ({ key: r.key as string, count: num(r.n) }))
        .sort((a, b) => b.count - a.count),
      sources: sourceBy,
      medianFirstResponseHours: hours === null ? null : round2(hours),
    };
  }

  // --- caregivers ------------------------------------------------------------------

  private async caregiverPipeline() {
    const rows = await this.db
      .select({ status: caregivers.status, n: count() })
      .from(caregivers)
      .where(isNull(caregivers.deletedAt))
      .groupBy(caregivers.status);
    const by = new Map(rows.map((r) => [r.status, num(r.n)]));
    return caregiverStatusEnum.map((key) => ({ key, count: by.get(key) ?? 0 }));
  }

  private async topCaregivers(periodStart: Date, periodEnd: Date) {
    const rows = await this.db
      .select({
        id: caregivers.id,
        name: caregivers.fullName,
        shifts: count(),
        minutes: sql<string>`SUM(TIMESTAMPDIFF(MINUTE, ${bookingShifts.startsAt}, ${bookingShifts.endsAt}))`,
      })
      .from(bookingShifts)
      .innerJoin(caregivers, eq(caregivers.id, bookingShifts.caregiverId))
      .where(and(eq(bookingShifts.status, 'COMPLETED'), gte(bookingShifts.startsAt, periodStart), lt(bookingShifts.startsAt, periodEnd)))
      .groupBy(caregivers.id, caregivers.fullName)
      .orderBy(sql`4 DESC`)
      .limit(5);
    return rows.map((r) => ({ id: r.id, name: r.name, shifts: num(r.shifts), hours: round2(num(r.minutes) / 60) }));
  }

  /** Who is on the books now, and how many of them are actually working (a shift within a week either side). */
  private async rightNow(today: string) {
    const weekAgo = colomboToUtc(addDays(today, -7), '00:00');
    const weekAhead = colomboToUtc(addDays(today, 8), '00:00');
    const [[active], [working], [clients]] = await Promise.all([
      this.db.select({ n: count() }).from(caregivers).where(and(eq(caregivers.status, 'ACTIVE'), isNull(caregivers.deletedAt))),
      this.db
        .select({ n: sql<string>`COUNT(DISTINCT ${bookingShifts.caregiverId})` })
        .from(bookingShifts)
        .innerJoin(caregivers, eq(caregivers.id, bookingShifts.caregiverId))
        .where(
          and(
            eq(caregivers.status, 'ACTIVE'),
            isNull(caregivers.deletedAt),
            inArray(bookingShifts.status, ['SCHEDULED', 'COMPLETED']),
            gte(bookingShifts.startsAt, weekAgo),
            lt(bookingShifts.startsAt, weekAhead),
          ),
        ),
      this.db
        .select({ n: sql<string>`COUNT(DISTINCT ${bookings.patientId})` })
        .from(bookings)
        .where(and(eq(bookings.status, 'CONFIRMED'), lte(bookings.startDate, today), gte(bookings.endDate, today))),
    ]);
    return { activeCaregivers: num(active?.n), workingCaregivers: num(working?.n), activeClients: num(clients?.n) };
  }

  // --- money -----------------------------------------------------------------------

  private async receivablesAging(today: string): Promise<InsightAgingBucket[]> {
    const late = sql`DATEDIFF(${today}, ${invoices.dueDate})`;
    const bucket = sql<string>`CASE
      WHEN ${invoices.dueDate} IS NULL OR ${late} <= 0 THEN 'current'
      WHEN ${late} <= 30 THEN 'd1_30'
      WHEN ${late} <= 60 THEN 'd31_60'
      WHEN ${late} <= 90 THEN 'd61_90'
      ELSE 'd90_plus' END`;
    const rows = await this.db
      .select({ key: bucket, amount: sql<string>`SUM(${invoices.total} - ${invoices.amountPaid})`, n: count() })
      .from(invoices)
      .where(and(eq(invoices.status, 'ISSUED'), sql`${invoices.total} > ${invoices.amountPaid}`))
      .groupBy(sql`1`);
    const by = new Map(rows.map((r) => [r.key, r]));
    return AGING_KEYS.map((key) => ({ key, amount: round2(num(by.get(key)?.amount)), count: num(by.get(key)?.n) }));
  }

  // --- operations --------------------------------------------------------------

  /** Shifts per day for the next 14 days: confirmed, and still-draft (planned but not confirmed). */
  private async upcomingShifts(today: string) {
    const rows = await this.db
      .select({ day: colomboDay(bookingShifts.startsAt), status: bookingShifts.status, n: count() })
      .from(bookingShifts)
      .where(
        and(
          inArray(bookingShifts.status, ['SCHEDULED', 'DRAFT']),
          gte(bookingShifts.startsAt, colomboToUtc(today, '00:00')),
          lt(bookingShifts.startsAt, colomboToUtc(addDays(today, 14), '00:00')),
        ),
      )
      .groupBy(sql`1`, bookingShifts.status);
    return Array.from({ length: 14 }, (_, i) => {
      const date = addDays(today, i);
      const at = (status: string) => num(rows.find((r) => r.day === date && r.status === status)?.n);
      return { date, scheduled: at('SCHEDULED'), draft: at('DRAFT') };
    });
  }

  /** Where demand comes from versus where the caregivers live - the gap is where to recruit. */
  private async demandSupply(locale: Locale, periodStart: Date, periodEnd: Date): Promise<InsightDistrictRow[]> {
    const [demand, supply, names] = await Promise.all([
      this.db
        .select({ districtId: patients.districtId, n: count() })
        .from(careRequests)
        .innerJoin(patients, eq(patients.id, careRequests.patientId))
        .where(and(isNotNull(patients.districtId), gte(careRequests.createdAt, periodStart), lt(careRequests.createdAt, periodEnd)))
        .groupBy(patients.districtId),
      this.db
        .select({ districtId: caregivers.districtId, n: count() })
        .from(caregivers)
        .where(and(eq(caregivers.status, 'ACTIVE'), isNull(caregivers.deletedAt), isNotNull(caregivers.districtId)))
        .groupBy(caregivers.districtId),
      this.db.select().from(districts),
    ]);
    const rows = new Map<number, InsightDistrictRow>();
    const row = (id: number) => {
      let r = rows.get(id);
      if (!r) {
        const d = names.find((n) => n.id === id);
        const district = d ? (locale === 'si' ? d.nameSi : locale === 'ta' ? d.nameTa : d.nameEn) : String(id);
        r = { districtId: id, district, requests: 0, activeCaregivers: 0 };
        rows.set(id, r);
      }
      return r;
    };
    for (const d of demand) if (d.districtId) row(d.districtId).requests = num(d.n);
    for (const s of supply) if (s.districtId) row(s.districtId).activeCaregivers = num(s.n);
    return [...rows.values()]
      .sort((a, b) => b.requests - a.requests || b.activeCaregivers - a.activeCaregivers || a.district.localeCompare(b.district))
      .slice(0, 8);
  }

  /** Counts that each need someone to do something. */
  private async attention(today: string): Promise<BusinessInsights['attention']> {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 3600_000);
    const weekAhead = colomboToUtc(addDays(today, 8), '00:00');
    const weekAgo = colomboToUtc(addDays(today, -7), '00:00');

    // Only shifts over 30 days old: monthly billing legitimately leaves the
    // current month's work open, and that is not a leak.
    const billableBefore = colomboToUtc(addDays(today, -30), '00:00');
    // A completed shift is billed if a live invoice has a line for it, or a
    // monthly line on its booking whose period covers the shift's day.
    const unbilled = sql<string>`SELECT COUNT(*) AS n FROM booking_shifts s
      WHERE s.status = 'COMPLETED' AND s.ends_at < ${billableBefore}
        AND NOT EXISTS (
          SELECT 1 FROM invoice_lines il JOIN invoices i ON i.id = il.invoice_id AND i.status <> 'VOID'
          WHERE il.shift_id = s.id
             OR (il.shift_id IS NULL AND il.booking_id = s.booking_id
                 AND DATE(DATE_ADD(s.starts_at, INTERVAL 330 MINUTE)) BETWEEN il.period_start AND il.period_end)
        )`;

    const [
      [staleNew],
      [unassigned],
      [draftBookings],
      [unconfirmed],
      [missedShifts],
      unbilledResult,
      [overdue],
      [payouts],
      [docs],
      [clients],
      [awaiting],
      care,
    ] = await Promise.all([
      this.db.select({ n: count() }).from(careRequests).where(and(eq(careRequests.status, 'NEW'), lt(careRequests.createdAt, dayAgo))),
      this.db
        .select({ n: count() })
        .from(careRequests)
        .where(and(inArray(careRequests.status, ['NEW', 'IN_PROGRESS']), isNull(careRequests.assignedToUserId))),
      this.db.select({ n: count() }).from(bookings).where(eq(bookings.status, 'DRAFT')),
      this.db
        .select({ n: count() })
        .from(bookingShifts)
        .where(and(eq(bookingShifts.status, 'DRAFT'), gte(bookingShifts.startsAt, now), lt(bookingShifts.startsAt, weekAhead))),
      this.db
        .select({ n: count() })
        .from(bookingShifts)
        .where(and(eq(bookingShifts.status, 'MISSED'), gte(bookingShifts.startsAt, weekAgo), lt(bookingShifts.startsAt, now))),
      this.db.execute(unbilled),
      this.db
        .select({ n: count(), amount: sql<string>`COALESCE(SUM(${invoices.total} - ${invoices.amountPaid}), 0)` })
        .from(invoices)
        .where(and(eq(invoices.status, 'ISSUED'), lt(invoices.dueDate, today))),
      this.db
        .select({ n: count(), amount: sql<string>`COALESCE(SUM(${payoutStatements.total}), 0)` })
        .from(payoutStatements)
        .where(eq(payoutStatements.status, 'APPROVED')),
      this.db.select({ n: count() }).from(caregiverDocuments).where(eq(caregiverDocuments.verificationStatus, 'PENDING')),
      this.db.select({ n: count() }).from(patients).where(eq(patients.status, 'PENDING_REVIEW')),
      this.db
        .select({ n: count() })
        .from(caregivers)
        .where(and(inArray(caregivers.status, ['DOCUMENTS_PENDING', 'UNDER_VERIFICATION']), isNull(caregivers.deletedAt))),
      this.carePlans.attention(today),
    ]);

    const unbilledRows = (Array.isArray(unbilledResult) ? unbilledResult[0] : unbilledResult) as unknown as { n: unknown }[];

    return {
      newRequestsOver24h: num(staleNew?.n),
      unassignedOpenRequests: num(unassigned?.n),
      draftBookings: num(draftBookings?.n),
      unconfirmedShiftsNext7d: num(unconfirmed?.n),
      missedShiftsLast7d: num(missedShifts?.n),
      unbilledCompletedShifts: num(unbilledRows?.[0]?.n),
      overdueInvoices: num(overdue?.n),
      overdueAmount: round2(num(overdue?.amount)),
      payoutsAwaitingPayment: num(payouts?.n),
      payoutsAwaitingAmount: round2(num(payouts?.amount)),
      documentsPending: num(docs?.n),
      clientsPendingReview: num(clients?.n),
      caregiversAwaitingVerification: num(awaiting?.n),
      careCriticalNotDone: care.criticalNotDone,
      careCriticalUnconfirmed: care.criticalUnconfirmed,
    };
  }
}
