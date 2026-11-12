/**
 * How the matching agent orders caregivers for a request. Pure rules, no
 * database and no model: the same request and the same caregivers always give
 * the same order, and every point has a reason a staff member can read.
 *
 * A model, when one is set up, may only reorder this list (see applyModelOrder);
 * it cannot add anyone, and it never sees who the people are.
 */

export type Urgency = 'IMMEDIATELY' | 'WITHIN_WEEK' | 'WITHIN_MONTH' | 'JUST_EXPLORING' | null;
export type Schedule = 'DAY' | 'NIGHT' | 'LIVE_IN_24H' | 'NOT_SURE' | null;

/** What the request asks for - nothing that says who the client is. */
export interface MatchRequest {
  careType: string;
  districtId: number;
  cityId: number | null;
  schedule: Schedule;
  urgency: Urgency;
  /** YYYY-MM-DD, when the client gave one. */
  desiredStartDate: string | null;
}

/** What is known about one caregiver who passed the hard checks. */
export interface MatchCandidate {
  caregiverId: string;
  registrationNumber: string;
  /** Verified or Active: the office has checked them. */
  verified: boolean;
  /** Lives in the request's town / district. */
  sameCity: boolean;
  sameDistrict: boolean;
  /** Lives elsewhere but has said they will travel to the request's town. */
  travelsToCity: boolean;
  dayDuty: boolean;
  nightDuty: boolean;
  liveIn24h: boolean;
  /** Clients' rating as 0..1 (ratingSignal); null when unrated or too few to count. */
  ratingSignal: number | null;
  ratingAverage: number | null;
  ratingCount: number;
  /** Their own rate for this kind of care, when it can be used as it stands. */
  ownRate: { amount: number; rateType: string } | null;
  /** YYYY-MM-DD they said they are free from; null when not given. */
  availableFrom: string | null;
  /** Confirmed bookings still running on the day the care would start. */
  runningBookings: number;
  /** Offers in the last 30 days they declined or let run out, and those they accepted. */
  recentUnanswered: number;
  recentAccepted: number;
}

export interface RankedMatch {
  caregiverId: string;
  registrationNumber: string;
  score: number;
  reasons: string[];
}

export const MATCH_WEIGHTS = {
  verified: 30,
  sameCity: 20,
  travelsToCity: 14,
  sameDistrict: 8,
  rating: 15,
  scheduleFit: 10,
  ownRate: 8,
  freeInTime: 5,
  notFreeInTime: -10,
  runningBooking: -15,
  unansweredOffer: -4,
  unansweredOfferCap: -12,
  acceptedOffer: 3,
  acceptedOfferCap: 6,
} as const;

const UNITS: Record<string, string> = { HOURLY: 'per hour', DAILY: 'per day', MONTHLY: 'per month' };

function scheduleFits(schedule: Schedule, c: Pick<MatchCandidate, 'dayDuty' | 'nightDuty' | 'liveIn24h'>): boolean | null {
  if (schedule === 'DAY') return c.dayDuty;
  if (schedule === 'NIGHT') return c.nightDuty;
  if (schedule === 'LIVE_IN_24H') return c.liveIn24h;
  return null;
}

/** One caregiver's score against one request, with the reasons in plain words. */
export function scoreMatch(request: MatchRequest, c: MatchCandidate): RankedMatch {
  const W = MATCH_WEIGHTS;
  let score = 0;
  const reasons: string[] = [];
  const add = (points: number, reason: string) => {
    score += points;
    reasons.push(reason);
  };

  if (c.verified) add(W.verified, 'Checked by the office');
  if (c.sameCity) add(W.sameCity, 'Lives in the same town');
  else if (c.travelsToCity) add(W.travelsToCity, 'Travels to this town');
  else if (c.sameDistrict) add(W.sameDistrict, 'Lives in the same district');

  if (c.ratingSignal !== null && c.ratingAverage !== null) {
    add(Math.round(W.rating * c.ratingSignal), `Rated ${c.ratingAverage.toFixed(1)} by ${c.ratingCount} client${c.ratingCount === 1 ? '' : 's'}`);
  }

  const fits = scheduleFits(request.schedule, c);
  if (fits === true) add(W.scheduleFit, request.schedule === 'DAY' ? 'Works day shifts' : request.schedule === 'NIGHT' ? 'Works night shifts' : 'Does live-in care');

  if (c.ownRate) add(W.ownRate, `Own rate LKR ${c.ownRate.amount.toLocaleString('en-LK')} ${UNITS[c.ownRate.rateType] ?? ''}`.trim());

  if (c.availableFrom) {
    // Someone needed at once is compared with today; the caller passes today's date as desiredStartDate then.
    if (request.desiredStartDate && c.availableFrom > request.desiredStartDate) add(W.notFreeInTime, `Free only from ${c.availableFrom}`);
    else if (request.desiredStartDate) add(W.freeInTime, 'Free by the start date');
  }

  if (c.runningBookings > 0) add(W.runningBooking, c.runningBookings === 1 ? 'Has a booking running then' : `Has ${c.runningBookings} bookings running then`);
  if (c.recentUnanswered > 0) {
    add(Math.max(W.unansweredOfferCap, W.unansweredOffer * c.recentUnanswered), `Turned down or missed ${c.recentUnanswered} recent offer${c.recentUnanswered === 1 ? '' : 's'}`);
  }
  if (c.recentAccepted > 0) add(Math.min(W.acceptedOfferCap, W.acceptedOffer * c.recentAccepted), 'Has accepted recent offers');

  return { caregiverId: c.caregiverId, registrationNumber: c.registrationNumber, score, reasons };
}

/** Best first. Ties go to the registration number, so the order never depends on how the database returned the rows. */
export function rankMatches(request: MatchRequest, candidates: MatchCandidate[]): RankedMatch[] {
  return candidates
    .map((c) => scoreMatch(request, c))
    .sort((a, b) => b.score - a.score || a.registrationNumber.localeCompare(b.registrationNumber));
}

/** How long a caregiver gets to answer, by how soon the care is needed. */
export function offerMinutesFor(urgency: Urgency): number {
  if (urgency === 'IMMEDIATELY') return 60;
  if (urgency === 'WITHIN_WEEK') return 4 * 60;
  return 24 * 60;
}

// --- the model's part ----------------------------------------------------------

export const RANK_PROMPT_VERSION = 'matching-rank-v1';
/** The model sees at most this many, the best by the rules. */
export const MODEL_SHORTLIST = 10;
/** A model may move a caregiver at most this many places from where the rules put them. */
export const MODEL_MAX_MOVE = 3;

const label = (i: number) => `C${i + 1}`;

/**
 * What a model is shown: the request's shape and each caregiver as "C1",
 * "C2"... with the same facts the rules used. No names, numbers, ids,
 * addresses or health details - there is nothing here to identify anyone.
 */
export function buildRankPrompt(request: MatchRequest & { cityName: string | null; districtName: string | null }, shortlist: MatchCandidate[], ranked: RankedMatch[]) {
  const byId = new Map(shortlist.map((c) => [c.caregiverId, c]));
  const rows = ranked.slice(0, MODEL_SHORTLIST).map((r, i) => {
    const c = byId.get(r.caregiverId)!;
    return {
      id: label(i),
      rulesScore: r.score,
      checkedByOffice: c.verified,
      livesInSameTown: c.sameCity,
      travelsToTown: c.travelsToCity,
      livesInSameDistrict: c.sameDistrict,
      dayShifts: c.dayDuty,
      nightShifts: c.nightDuty,
      liveIn: c.liveIn24h,
      rating: c.ratingSignal === null ? null : { average: c.ratingAverage, count: c.ratingCount },
      ownRate: c.ownRate,
      freeFrom: c.availableFrom,
      bookingsRunningThen: c.runningBookings,
      recentOffersTurnedDownOrMissed: c.recentUnanswered,
      recentOffersAccepted: c.recentAccepted,
    };
  });
  const system =
    'You help a home-care agency in Sri Lanka decide which caregivers to offer a job to first. ' +
    'You are given the job and a shortlist already ordered by fixed rules. Reorder it only where the facts given justify it: ' +
    'prefer caregivers the office has checked, who are close, free in time, fit the schedule and are likely to accept. ' +
    'Use only the facts given. Do not invent facts. ' +
    'Answer with one JSON object: {"order": ["C2", "C1", ...], "reasons": {"C2": "one short sentence"}}. ' +
    'Include every id exactly once. Give a reason only for an id you moved.';
  const user = JSON.stringify({
    job: {
      careType: request.careType,
      town: request.cityName,
      district: request.districtName,
      schedule: request.schedule,
      neededBy: request.urgency,
      startDate: request.desiredStartDate,
    },
    shortlist: rows,
  });
  return { system, user, labels: rows.map((r) => r.id) };
}

/**
 * Applies a model's answer to the rules' order, and trusts none of it: ids it
 * made up are dropped, ids it left out keep their place, nobody moves more
 * than MODEL_MAX_MOVE places, and its reasons are cut to one short line.
 * Anything unreadable leaves the rules' order as it was.
 */
export function applyModelOrder(ranked: RankedMatch[], content: string): { ranked: RankedMatch[]; moved: number } {
  const head = ranked.slice(0, MODEL_SHORTLIST);
  const tail = ranked.slice(MODEL_SHORTLIST);
  let parsed: { order?: unknown; reasons?: unknown };
  try {
    const start = content.indexOf('{');
    const end = content.lastIndexOf('}');
    parsed = JSON.parse(start >= 0 && end > start ? content.slice(start, end + 1) : content);
  } catch {
    return { ranked, moved: 0 };
  }
  if (!parsed || !Array.isArray(parsed.order)) return { ranked, moved: 0 };

  const index = new Map(head.map((_, i) => [label(i), i]));
  const wanted: number[] = [];
  for (const id of parsed.order) {
    const i = typeof id === 'string' ? index.get(id.trim().toUpperCase()) : undefined;
    if (i !== undefined && !wanted.includes(i)) wanted.push(i);
  }
  // Position the model asked for; those it left out stay where the rules put them.
  const asked = new Map(wanted.map((i, pos) => [i, pos]));
  const target = head.map((_, i) => {
    const pos = asked.get(i) ?? i;
    return { i, key: Math.max(i - MODEL_MAX_MOVE, Math.min(i + MODEL_MAX_MOVE, pos)) };
  });
  target.sort((a, b) => a.key - b.key || a.i - b.i);

  const reasons = parsed.reasons && typeof parsed.reasons === 'object' ? (parsed.reasons as Record<string, unknown>) : {};
  let moved = 0;
  const reordered = target.map(({ i }, pos) => {
    const r = head[i];
    if (pos === i) return r;
    moved++;
    const why = reasons[label(i)];
    const text = typeof why === 'string' ? why.replace(/\s+/g, ' ').trim().slice(0, 160) : '';
    return text ? { ...r, reasons: [...r.reasons, `AI: ${text}`] } : r;
  });
  return { ranked: [...reordered, ...tail], moved };
}
