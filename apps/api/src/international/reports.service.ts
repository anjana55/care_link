import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import { and, eq, gte, isNotNull, isNull, lt, lte, ne } from 'drizzle-orm';
import {
  placementStatusValues,
  welfareSeverityValues,
  type MoneyByCurrency,
  type OverseasReport,
  type PlacementStatus,
  type WelfareSeverity,
} from '@care-platform/shared';
import { DRIZZLE, type Database } from '../database/database.module';
import {
  candidateInterviews,
  caregiverAssessments,
  caregiverOverseasProfiles,
  employerEnquiries,
  enquiryCandidates,
  jobOffers,
  overseasVacancies,
  placementCheckins,
  placementInvoicePayments,
  placementInvoices,
  placements,
  trainingCertificates,
  trainingEnrolments,
  welfareReports,
} from '../database/schema';
import { ReportQueryDto } from './dto/phase4.dto';
import { addDays, addMonths, todayColombo } from './dates';
import { guaranteeEndsOn } from './placements.service';

// --- pure helpers (unit-tested) -----------------------------------------------------------

/** The range asked for, or the last 12 months to today. At most five years. */
export function resolveRange(q: ReportQueryDto, today = todayColombo()): { from: string; to: string } {
  const to = q.to ?? today;
  const from = q.from ?? addDays(addMonths(to, -12), 1);
  if (from > to) throw new BadRequestException('The start of the range is after its end.');
  if (addMonths(from, 60) < to) throw new BadRequestException('Choose a range of five years or less.');
  return { from, to };
}

/** A Colombo calendar day as the UTC instants that bound it: [start, next day's start). */
export function dayBoundsUtc(from: string, to: string): { start: Date; end: Date } {
  return { start: new Date(`${from}T00:00:00+05:30`), end: new Date(`${addDays(to, 1)}T00:00:00+05:30`) };
}

/** The Colombo month (YYYY-MM) of a stored instant. */
export const colomboMonth = (d: Date | string) => new Date(new Date(d).getTime() + 5.5 * 3600_000).toISOString().slice(0, 7);

/** Every month from `from` to `to`, oldest first. */
export function monthsBetween(from: string, to: string): string[] {
  const out: string[] = [];
  let m = `${from.slice(0, 7)}-01`;
  while (m.slice(0, 7) <= to.slice(0, 7)) {
    out.push(m.slice(0, 7));
    m = addMonths(m, 1);
  }
  return out;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : Math.round(((s[mid - 1] + s[mid]) / 2) * 10) / 10;
}

export function average(values: number[]): number | null {
  return values.length ? Math.round((values.reduce((a, b) => a + b, 0) / values.length) * 10) / 10 : null;
}

export const daysBetween = (a: Date | string, b: Date | string) => Math.max(0, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 86_400_000));

/** Adds money in integer cents, so 0.1 + 0.2 stays 0.30. */
export class MoneyTotals {
  private readonly cents = new Map<string, number>();
  add(currency: string, amount: string | number) {
    this.cents.set(currency, (this.cents.get(currency) ?? 0) + Math.round(Number(amount) * 100));
    return this;
  }
  list(): MoneyByCurrency[] {
    return [...this.cents.entries()]
      .filter(([, c]) => c !== 0)
      .sort((a, b) => b[1] - a[1])
      .map(([currency, c]) => ({ currency, amount: (c / 100).toFixed(2) }));
  }
}

/**
 * The numbers behind the international business: how enquiries turn into
 * placements, how long that takes, what the placement fees bring in, where
 * the demand is against who is ready to go, and how placements end.
 * Everything is counted by the Colombo calendar day.
 */
@Injectable()
export class ReportsService {
  constructor(@Inject(DRIZZLE) private readonly db: Database) {}

  async report(q: ReportQueryDto): Promise<OverseasReport> {
    const today = todayColombo();
    const range = resolveRange(q, today);
    const { start, end } = dayBoundsUtc(range.from, range.to);
    const inRange = (col: Parameters<typeof gte>[0]) => and(gte(col, start), lt(col, end));
    const inDays = (col: Parameters<typeof gte>[0]) => and(gte(col, range.from), lte(col, range.to));

    const [
      enquiries,
      proposed,
      interviewsHeld,
      offersSent,
      offersAccepted,
      newPlacements,
      allPlacements,
      issued,
      payments,
      outstanding,
      vacancies,
      pool,
      checkins,
      welfare,
      enrolments,
      completions,
      certificates,
      assessments,
    ] = await Promise.all([
      this.db
        .select({ id: employerEnquiries.id, createdAt: employerEnquiries.createdAt, country: employerEnquiries.country, rolesCount: employerEnquiries.rolesCount, careSettings: employerEnquiries.careSettings })
        .from(employerEnquiries)
        .where(inRange(employerEnquiries.createdAt)),
      this.db.select({ id: enquiryCandidates.id }).from(enquiryCandidates).where(inRange(enquiryCandidates.createdAt)),
      this.db
        .select({ id: candidateInterviews.id })
        .from(candidateInterviews)
        .where(and(eq(candidateInterviews.status, 'COMPLETED'), inRange(candidateInterviews.scheduledAt))),
      this.db.select({ id: jobOffers.id }).from(jobOffers).where(and(isNotNull(jobOffers.sentAt), inRange(jobOffers.sentAt))),
      this.db.select({ id: jobOffers.id }).from(jobOffers).where(and(eq(jobOffers.status, 'ACCEPTED'), inRange(jobOffers.respondedAt))),
      this.db
        .select({
          id: placements.id,
          createdAt: placements.createdAt,
          country: placements.country,
          enquiryCreatedAt: employerEnquiries.createdAt,
          candidateCreatedAt: enquiryCandidates.createdAt,
        })
        .from(placements)
        .innerJoin(employerEnquiries, eq(placements.enquiryId, employerEnquiries.id))
        .innerJoin(enquiryCandidates, eq(placements.candidateId, enquiryCandidates.id))
        .where(inRange(placements.createdAt)),
      this.db
        .select({ status: placements.status, endedOn: placements.endedOn, contractStartOn: placements.contractStartOn, arrivedOn: placements.arrivedOn, guaranteeMonths: placements.guaranteeMonths })
        .from(placements),
      this.db
        .select({ currency: placementInvoices.currency, amount: placementInvoices.amount })
        .from(placementInvoices)
        .where(and(ne(placementInvoices.status, 'VOID'), ne(placementInvoices.status, 'DRAFT'), inDays(placementInvoices.issueDate))),
      this.db
        .select({ amount: placementInvoicePayments.amount, paidOn: placementInvoicePayments.paidOn, currency: placementInvoices.currency, country: employerEnquiries.country })
        .from(placementInvoicePayments)
        .innerJoin(placementInvoices, eq(placementInvoicePayments.invoiceId, placementInvoices.id))
        .innerJoin(employerEnquiries, eq(placementInvoices.enquiryId, employerEnquiries.id))
        .where(inDays(placementInvoicePayments.paidOn)),
      this.db
        .select({ currency: placementInvoices.currency, amount: placementInvoices.amount, amountPaid: placementInvoices.amountPaid, dueDate: placementInvoices.dueDate })
        .from(placementInvoices)
        .where(eq(placementInvoices.status, 'ISSUED')),
      this.db
        .select({ country: overseasVacancies.country, rolesCount: overseasVacancies.rolesCount, careSetting: overseasVacancies.careSetting })
        .from(overseasVacancies)
        .where(and(inRange(overseasVacancies.createdAt), ne(overseasVacancies.status, 'REJECTED'))),
      this.db
        .select({ targetCountries: caregiverOverseasProfiles.targetCountries })
        .from(caregiverOverseasProfiles)
        .where(eq(caregiverOverseasProfiles.openToOverseas, true)),
      this.db
        .select({ completedOn: placementCheckins.completedOn })
        .from(placementCheckins)
        .where(and(gte(placementCheckins.dueOn, range.from), lte(placementCheckins.dueOn, range.to < today ? range.to : today))),
      this.db.select({ severity: welfareReports.severity }).from(welfareReports).where(inRange(welfareReports.createdAt)),
      this.db.select({ id: trainingEnrolments.id }).from(trainingEnrolments).where(inRange(trainingEnrolments.createdAt)),
      this.db
        .select({ id: trainingEnrolments.id })
        .from(trainingEnrolments)
        .where(and(eq(trainingEnrolments.status, 'COMPLETED'), inDays(trainingEnrolments.completedAt))),
      this.db
        .select({ id: trainingCertificates.id })
        .from(trainingCertificates)
        .where(and(isNull(trainingCertificates.revokedAt), inDays(trainingCertificates.issuedOn))),
      this.db.select({ id: caregiverAssessments.id }).from(caregiverAssessments).where(and(isNotNull(caregiverAssessments.verifiedAt), inRange(caregiverAssessments.verifiedAt))),
    ]);

    // monthly
    const months = monthsBetween(range.from, range.to);
    const monthly = new Map(months.map((m) => [m, { month: m, enquiries: 0, placements: 0, collected: new MoneyTotals() }]));
    for (const e of enquiries) {
      const row = monthly.get(colomboMonth(e.createdAt));
      if (row) row.enquiries++;
    }
    for (const p of newPlacements) {
      const row = monthly.get(colomboMonth(p.createdAt));
      if (row) row.placements++;
    }
    for (const pay of payments) monthly.get(String(pay.paidOn).slice(0, 7))?.collected.add(pay.currency, pay.amount);

    // revenue
    const invoiced = new MoneyTotals();
    for (const i of issued) invoiced.add(i.currency, i.amount);
    const collected = new MoneyTotals();
    const byCountry = new Map<string, MoneyTotals>();
    for (const pay of payments) {
      collected.add(pay.currency, pay.amount);
      byCountry.set(pay.country, (byCountry.get(pay.country) ?? new MoneyTotals()).add(pay.currency, pay.amount));
    }
    const owed = new MoneyTotals();
    for (const i of outstanding) owed.add(i.currency, Number(i.amount) - Number(i.amountPaid));

    // demand against supply
    const demand = new Map<string, { country: string; enquiries: number; vacancies: number; roles: number; placements: number; talentPool: number }>();
    const d = (country: string) => {
      let row = demand.get(country);
      if (!row) demand.set(country, (row = { country, enquiries: 0, vacancies: 0, roles: 0, placements: 0, talentPool: 0 }));
      return row;
    };
    for (const e of enquiries) {
      const row = d(e.country);
      row.enquiries++;
      row.roles += e.rolesCount;
    }
    for (const v of vacancies) {
      const row = d(v.country);
      row.vacancies++;
    }
    for (const p of newPlacements) d(p.country).placements++;
    const poolBy = new Map<string, number>();
    for (const p of pool) for (const c of p.targetCountries ?? []) poolBy.set(c, (poolBy.get(c) ?? 0) + 1);
    for (const row of demand.values()) row.talentPool = poolBy.get(row.country) ?? 0;
    // Countries caregivers want but no one has asked from yet are worth seeing too.
    for (const [country, n] of poolBy) if (!demand.has(country)) demand.set(country, { country, enquiries: 0, vacancies: 0, roles: 0, placements: 0, talentPool: n });

    const settings = new Map<string, { careSetting: string; enquiries: number; vacancies: number }>();
    const s = (k: string) => {
      let row = settings.get(k);
      if (!row) settings.set(k, (row = { careSetting: k, enquiries: 0, vacancies: 0 }));
      return row;
    };
    for (const e of enquiries) for (const c of e.careSettings ?? []) s(c).enquiries++;
    for (const v of vacancies) s(v.careSetting).vacancies++;

    // outcomes
    const byStatus = Object.fromEntries(placementStatusValues.map((k) => [k, 0])) as Record<PlacementStatus, number>;
    let endedEarlyInGuarantee = 0;
    for (const p of allPlacements) {
      byStatus[p.status]++;
      if (p.status === 'ENDED_EARLY') {
        const until = guaranteeEndsOn(p);
        if (until && p.endedOn && p.endedOn <= until) endedEarlyInGuarantee++;
      }
    }
    const welfareBySeverity = Object.fromEntries(welfareSeverityValues.map((k) => [k, 0])) as Record<WelfareSeverity, number>;
    for (const w of welfare) welfareBySeverity[w.severity]++;

    const enquiryDays = newPlacements.map((p) => daysBetween(p.enquiryCreatedAt, p.createdAt));
    const candidateDays = newPlacements.map((p) => daysBetween(p.candidateCreatedAt, p.createdAt));

    return {
      range,
      funnel: {
        enquiries: enquiries.length,
        candidatesProposed: proposed.length,
        interviewsHeld: interviewsHeld.length,
        offersSent: offersSent.length,
        offersAccepted: offersAccepted.length,
        placements: newPlacements.length,
      },
      monthly: [...monthly.values()].map((m) => ({ month: m.month, enquiries: m.enquiries, placements: m.placements, collected: m.collected.list() })),
      timeToPlace: {
        placements: newPlacements.length,
        medianDays: median(enquiryDays),
        averageDays: average(enquiryDays),
        medianCandidateDays: median(candidateDays),
      },
      revenue: {
        invoiced: invoiced.list(),
        collected: collected.list(),
        outstanding: owed.list(),
        overdueInvoices: outstanding.filter((i) => i.dueDate && i.dueDate < today).length,
        collectedByCountry: [...byCountry.entries()]
          .flatMap(([country, totals]) => totals.list().map((m) => ({ country, currency: m.currency, amount: m.amount })))
          .sort((a, b) => Number(b.amount) - Number(a.amount)),
      },
      demand: [...demand.values()].sort((a, b) => b.enquiries + b.vacancies - (a.enquiries + a.vacancies) || b.talentPool - a.talentPool).slice(0, 25),
      careSettings: [...settings.values()].sort((a, b) => b.enquiries + b.vacancies - (a.enquiries + a.vacancies)),
      outcomes: {
        byStatus,
        endedEarly: byStatus.ENDED_EARLY,
        endedEarlyInGuarantee,
        checkinsDue: checkins.length,
        checkinsDone: checkins.filter((c) => c.completedOn).length,
        welfareBySeverity,
      },
      training: {
        interested: enrolments.length,
        completions: completions.length,
        certificatesIssued: certificates.length,
        assessmentsVerified: assessments.length,
      },
    };
  }
}
