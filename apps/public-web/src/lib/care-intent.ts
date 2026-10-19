import { useCallback, useSyncExternalStore } from 'react';
import { COLOMBO_TIME_ZONE, type SearchRequest } from '@care-platform/shared';
import type { PatientIntakeValues } from './schemas/patient-intake';

/**
 * What a signed-out visitor has already told us, kept on their device so the
 * client journey never asks twice:
 *
 * - the last search they ran (and, for AI Search, what they typed), which
 *   pre-fills the care intake on sign-up and restores their results on /find;
 * - the caregiver they were about to contact, so signing up or in brings them
 *   straight back with the request dialog open;
 * - a device shortlist, so Save works before there is an account and is
 *   copied to the account the moment they sign in as a client.
 *
 * localStorage for the same reason as return-to.ts: email sign-up finishes in
 * whatever tab the verification link opens. Everything expires (the shortlist
 * aside) so a shared computer does not hand one visitor's care needs to the
 * next, and every read is defensive - storage may be blocked or hand-edited.
 */

const SEARCH_KEY = 'care-platform-last-search';
const PENDING_KEY = 'care-platform-pending-contact';
const SHORTLIST_KEY = 'care-platform-device-shortlist';
const DAY_MS = 24 * 60 * 60 * 1000;
const SHORTLIST_MAX = 50;
const SHORTLIST_EVENT = 'care-platform-shortlist-change';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function readJson<T>(key: string): T | null {
  try {
    const raw = window.localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Storage blocked (private mode): the journey still works, it just asks again.
  }
}

function remove(key: string) {
  try {
    window.localStorage.removeItem(key);
  } catch {
    // ignore
  }
}

/* ------------------------------------------------------------------------ */
/* The last search                                                          */
/* ------------------------------------------------------------------------ */

export interface SearchContext {
  request: SearchRequest;
  /** The free-text description typed into AI Search, when that was used. */
  aiQuery?: string;
  /** Names of the skills picked, resolved when the search ran (ids alone mean nothing to staff). */
  skillNames?: string[];
}

export function rememberSearch(context: SearchContext) {
  writeJson(SEARCH_KEY, { ...context, at: Date.now() });
}

export function loadSearch(): SearchContext | null {
  const stored = readJson<SearchContext & { at?: unknown }>(SEARCH_KEY);
  if (!stored || typeof stored.at !== 'number' || Date.now() - stored.at > DAY_MS) return null;
  if (!stored.request || typeof stored.request !== 'object') return null;
  return {
    request: stored.request,
    aiQuery: typeof stored.aiQuery === 'string' ? stored.aiQuery : undefined,
    skillNames: Array.isArray(stored.skillNames) ? stored.skillNames.filter((s) => typeof s === 'string') : undefined,
  };
}

export function forgetSearch() {
  remove(SEARCH_KEY);
}

/* ------------------------------------------------------------------------ */
/* The caregiver they were about to contact                                 */
/* ------------------------------------------------------------------------ */

export function rememberPendingContact(publicId: string) {
  if (!UUID.test(publicId)) return;
  writeJson(PENDING_KEY, { publicId, at: Date.now() });
}

/** The caregiver a visitor set out to contact in the last day, if any. Does not clear it. */
export function peekPendingContact(): string | null {
  const stored = readJson<{ publicId?: unknown; at?: unknown }>(PENDING_KEY);
  if (!stored || typeof stored.publicId !== 'string' || typeof stored.at !== 'number') return null;
  if (Date.now() - stored.at > DAY_MS || !UUID.test(stored.publicId)) return null;
  return stored.publicId;
}

export function clearPendingContact() {
  remove(PENDING_KEY);
}

/* ------------------------------------------------------------------------ */
/* Device shortlist                                                         */
/* ------------------------------------------------------------------------ */

export function readDeviceShortlist(): string[] {
  const stored = readJson<unknown>(SHORTLIST_KEY);
  return Array.isArray(stored) ? stored.filter((id): id is string => typeof id === 'string' && UUID.test(id)).slice(0, SHORTLIST_MAX) : [];
}

function writeDeviceShortlist(ids: string[]) {
  if (ids.length === 0) remove(SHORTLIST_KEY);
  else writeJson(SHORTLIST_KEY, ids.slice(0, SHORTLIST_MAX));
  try {
    window.dispatchEvent(new Event(SHORTLIST_EVENT));
  } catch {
    // ignore
  }
}

export function setDeviceSaved(publicId: string, saved: boolean) {
  if (!UUID.test(publicId)) return;
  const current = readDeviceShortlist().filter((id) => id !== publicId);
  writeDeviceShortlist(saved ? [publicId, ...current] : current);
}

/** Drops the given ids (the ones copied to the account) and keeps any that failed. */
export function removeFromDeviceShortlist(ids: string[]) {
  const drop = new Set(ids);
  writeDeviceShortlist(readDeviceShortlist().filter((id) => !drop.has(id)));
}

// useSyncExternalStore needs a stable snapshot, so the parsed list is cached
// against the raw string it came from.
let cachedRaw: string | null | undefined;
let cachedList: string[] = [];
function shortlistSnapshot(): string[] {
  let raw: string | null = null;
  try {
    raw = window.localStorage.getItem(SHORTLIST_KEY);
  } catch {
    raw = null;
  }
  if (raw !== cachedRaw) {
    cachedRaw = raw;
    cachedList = readDeviceShortlist();
  }
  return cachedList;
}
const EMPTY: string[] = [];

function subscribe(onChange: () => void) {
  window.addEventListener(SHORTLIST_EVENT, onChange);
  window.addEventListener('storage', onChange); // other tabs
  return () => {
    window.removeEventListener(SHORTLIST_EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** The device shortlist, live across components and tabs. */
export function useDeviceShortlist() {
  const ids = useSyncExternalStore(subscribe, shortlistSnapshot, () => EMPTY);
  const isSaved = useCallback((publicId: string) => ids.includes(publicId), [ids]);
  return { ids, isSaved, setSaved: setDeviceSaved };
}

/* ------------------------------------------------------------------------ */
/* Search -> care intake                                                    */
/* ------------------------------------------------------------------------ */

/** Today in Colombo as YYYY-MM-DD - the day the care is planned around. */
export function colomboToday(now = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: COLOMBO_TIME_ZONE, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

const daysBetween = (from: string, to: string) =>
  Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

/** A start date picked in search -> the coarse "when should care start" the intake asks for. */
export function careStartFromDate(date: string | undefined, today: string): PatientIntakeValues['careStart'] | undefined {
  if (!date || Number.isNaN(Date.parse(`${date}T00:00:00Z`))) return undefined;
  const days = daysBetween(today, date);
  if (days <= 2) return 'IMMEDIATELY';
  if (days <= 7) return 'WITHIN_WEEK';
  if (days <= 31) return 'WITHIN_MONTH';
  // Further out than the intake's buckets go: let the client say.
  return undefined;
}

const SHIFT_TO_SCHEDULE: Record<string, PatientIntakeValues['careSchedule']> = {
  DAY: 'DAY',
  NIGHT: 'NIGHT',
  TWENTY_FOUR_HOUR_LIVE_IN: 'LIVE_IN_24H',
  FLEXIBLE: 'NOT_SURE',
};

const GENDER_PREFERENCE: Record<string, PatientIntakeValues['preferredCaregiverGender']> = {
  ANY: 'NO_PREFERENCE',
  MALE: 'MALE',
  FEMALE: 'FEMALE',
};

const CARE_NEEDS_MIN = 10;
const CARE_NEEDS_MAX = 1000;

/**
 * The care-needs note staff read, written from the search: what the visitor
 * typed into AI Search, the help they asked for and any health conditions.
 * Undefined when there is not enough to say - the client then writes it.
 */
export function careNeedsFromSearch(context: SearchContext, t: (key: string, params?: Record<string, string | number>) => string) {
  const parts: string[] = [];
  const typed = context.aiQuery?.trim();
  if (typed) parts.push(typed);
  if (context.skillNames && context.skillNames.length > 0) parts.push(t('careIntent.needs.help', { list: context.skillNames.join(', ') }));
  const conditions = context.request.patient?.medicalConditions ?? [];
  if (conditions.length > 0) parts.push(t('careIntent.needs.conditions', { list: conditions.join(', ') }));
  const text = parts.join('\n').trim();
  return text.length >= CARE_NEEDS_MIN ? text.slice(0, CARE_NEEDS_MAX) : undefined;
}

/**
 * Everything the sign-up intake can take from the last search. Only fields the
 * search actually answered are returned - nothing is guessed - so whatever is
 * missing is simply left for the client, and every carried-over answer stays
 * editable on the form.
 */
export function intakeDefaultsFromSearch(
  context: SearchContext,
  t: (key: string, params?: Record<string, string | number>) => string,
  today = colomboToday(),
): Partial<PatientIntakeValues> {
  const { request } = context;
  const defaults: Partial<PatientIntakeValues> = {};
  const age = request.patient?.age;
  if (typeof age === 'number' && Number.isInteger(age) && age >= 0 && age <= 120) defaults.recipientAge = age;
  if (request.patient?.gender === 'MALE' || request.patient?.gender === 'FEMALE') defaults.recipientGender = request.patient.gender;
  if (request.location?.districtId) defaults.districtId = request.location.districtId;
  if (request.location?.districtId && request.location.cityId) defaults.cityId = request.location.cityId;
  if (request.shift && SHIFT_TO_SCHEDULE[request.shift]) defaults.careSchedule = SHIFT_TO_SCHEDULE[request.shift];
  const start = careStartFromDate(request.desiredStartDate, today);
  if (start) defaults.careStart = start;
  if (request.caregiverGenderPreference && GENDER_PREFERENCE[request.caregiverGenderPreference]) {
    defaults.preferredCaregiverGender = GENDER_PREFERENCE[request.caregiverGenderPreference];
  }
  const needs = careNeedsFromSearch(context, t);
  if (needs) defaults.careNeeds = needs;
  return defaults;
}
