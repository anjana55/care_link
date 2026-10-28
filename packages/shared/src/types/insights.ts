/**
 * The staff dashboard's business insights: one call, everything the vital
 * signs need. Types only - see index.ts for why nothing here may need a
 * runtime import beyond plain constants.
 *
 * Money is in rupees as plain numbers (already rounded to 2 dp); the
 * dashboard only displays it, it never does arithmetic that would need cents.
 */

export const insightRangeValues = ['30d', '90d', '12m'] as const;
export type InsightRange = (typeof insightRangeValues)[number];

/** A headline number for the chosen period, and the same measure for the period just before it. */
export interface InsightKpi {
  value: number;
  /** Same-length period immediately before. Null when the business did not exist yet (nothing to compare). */
  previous: number | null;
}

/** A ratio shown as a dial. `value` is 0..1, or null when the denominator is zero (nothing to measure). */
export interface InsightRatio {
  value: number | null;
  numerator: number;
  denominator: number;
}

export interface InsightBucket {
  /** First day of the bucket, YYYY-MM-DD (Asia/Colombo). */
  start: string;
  /** Last day of the bucket, inclusive. */
  end: string;
}

export interface InsightNamedCount {
  key: string;
  count: number;
}

export interface InsightDistrictRow {
  districtId: number;
  district: string;
  /** Care requests in the period from clients in this district. */
  requests: number;
  /** Caregivers ACTIVE now whose home district this is. */
  activeCaregivers: number;
}

export interface InsightTopCaregiver {
  id: string;
  name: string;
  hours: number;
  shifts: number;
}

export interface InsightDayLoad {
  date: string;
  /** Confirmed shifts starting that day. */
  scheduled: number;
  /** Shifts still on a draft booking - planned but not confirmed. */
  draft: number;
}

export interface InsightAgingBucket {
  key: 'current' | 'd1_30' | 'd31_60' | 'd61_90' | 'd90_plus';
  amount: number;
  count: number;
}

export interface BusinessInsights {
  range: InsightRange;
  /** First and last day of the period (inclusive), YYYY-MM-DD, Asia/Colombo. */
  from: string;
  to: string;
  generatedAt: string;
  bucketUnit: 'day' | 'week' | 'month';
  buckets: InsightBucket[];

  kpis: {
    /** Invoices issued in the period, total incl. tax. */
    invoiced: InsightKpi;
    /** Client payments received in the period. */
    collected: InsightKpi;
    /** Earned on shifts completed in the period: client rate minus caregiver pay (shifts with no rate are left out). */
    grossMargin: InsightKpi;
    newRequests: InsightKpi;
    /** Bookings confirmed in the period. */
    placements: InsightKpi;
    /** Hours of completed shifts in the period. */
    careHours: InsightKpi;
    newClients: InsightKpi;
    newCaregivers: InsightKpi;
    /** Right now, not period-bound. */
    activeCaregivers: number;
    /** Clients with a confirmed booking covering today. */
    activeClients: number;
  };

  /** Per-bucket series, aligned with `buckets`. */
  series: {
    invoiced: number[];
    collected: number[];
    requests: number[];
    placements: number[];
    careHours: number[];
  };

  dials: {
    /** Requests created in the period that went on to a booking (or were closed as placed). */
    conversion: InsightRatio;
    /** Collected / invoiced in the period. Can exceed 1 when old invoices are paid off. */
    collection: InsightRatio;
    /** ACTIVE caregivers with a shift in the 7 days either side of today. */
    utilization: InsightRatio;
    /** Completed / (completed + missed) shifts in the period. */
    attendance: InsightRatio;
    /** Gross margin / client value of the completed shifts it was earned on. */
    margin: InsightRatio;
  };

  requests: {
    funnel: { created: number; contacted: number; introduced: number; booked: number };
    /** Open pipeline right now, by status. */
    open: { NEW: number; IN_PROGRESS: number; INTRODUCED: number };
    closeReasons: InsightNamedCount[];
    sources: { WEB: number; PHONE: number };
    /** Median hours from a request arriving to its first staff action. Null when none were actioned. */
    medianFirstResponseHours: number | null;
  };

  caregiverPipeline: InsightNamedCount[];
  receivablesAging: InsightAgingBucket[];
  upcomingShifts: InsightDayLoad[];
  demandSupply: InsightDistrictRow[];
  topCaregivers: InsightTopCaregiver[];

  /** Things somebody should act on today. Every count links to a filtered list in the UI. */
  attention: {
    newRequestsOver24h: number;
    unassignedOpenRequests: number;
    draftBookings: number;
    unconfirmedShiftsNext7d: number;
    missedShiftsLast7d: number;
    unbilledCompletedShifts: number;
    overdueInvoices: number;
    overdueAmount: number;
    payoutsAwaitingPayment: number;
    payoutsAwaitingAmount: number;
    documentsPending: number;
    clientsPendingReview: number;
    caregiversAwaitingVerification: number;
    /** Care-plan items on critical activities the client marked Not done, last 7 days. */
    careCriticalNotDone: number;
    /** Care-plan items on critical activities nobody confirmed (filled in at midnight), last 7 days. */
    careCriticalUnconfirmed: number;
  };
}
