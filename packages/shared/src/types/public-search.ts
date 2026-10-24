import { z } from 'zod';
import { LOCALES, type Locale } from './locale';
import {
  MAX_SEARCH_RADIUS_KM,
  type CaregiverHomeLocation,
  type MapCityPoint,
  type SearchOrigin,
  type ServiceAreaCity,
} from './geo';
import { careTypeValues, type CareType } from './care-types';

/**
 * Domain types shared between apps/api (source of truth, validated again with
 * class-validator DTOs that structurally mirror these shapes) and apps/public-web
 * (form state + API client typing). Keeping these here means the public
 * frontend and the public-search API contract can't silently drift apart.
 *
 * IMPORTANT: nothing in this file may include internal-only fields (NIC,
 * passport, phone, address, health information, verification notes, audit
 * data). If a field isn't safe to show an anonymous visitor, it doesn't
 * belong in this file at all.
 */

export const genderPreferenceValues = ['MALE', 'FEMALE', 'ANY'] as const;
export type GenderPreference = (typeof genderPreferenceValues)[number];

export const shiftRequirementValues = ['DAY', 'NIGHT', 'TWENTY_FOUR_HOUR_LIVE_IN', 'FLEXIBLE'] as const;
export type ShiftRequirement = (typeof shiftRequirementValues)[number];

/**
 * "Left blank" reaches the resolver in two shapes, and neither is `undefined`:
 * an untouched `valueAsNumber` input yields `NaN`, and a blank `<select>` yields
 * `''`. A bare `.optional()` only accepts `undefined`, so both fail validation
 * and block submit even though every field is declared optional. Normalize
 * blanks (and trim stray whitespace) to `undefined` before the inner schema runs.
 */
const blankToUndefined = (value: unknown) => {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    return trimmed === '' ? undefined : trimmed;
  }
  if (value === null || (typeof value === 'number' && Number.isNaN(value))) return undefined;
  return value;
};

/** `schema.optional()` that also treats a blank form value as "not provided". */
const optionalOf = <T extends z.ZodTypeAny>(schema: T) => z.preprocess(blankToUndefined, schema.optional());

/**
 * What a guardian fills in on the Normal Search form (or what the AI step extracts).
 *
 * Care type, district and desired start date are the only mandatory inputs - everything
 * else is a refinement that narrows or re-ranks an already-usable result set.
 * Both are checked in `superRefine` rather than with `.min(1)` on the fields so
 * that a blank select, a whitespace-only value, and an omitted key all produce
 * the same "required" error at the same path. Keeping them out of the field
 * definitions also leaves the inferred `SearchRequest` type fully optional,
 * which the AI extraction path depends on.
 */
export const searchRequestSchema = z
  .object({
    patient: optionalOf(
      z.object({
        age: optionalOf(z.number().int().min(0).max(120)),
        gender: optionalOf(z.enum(['MALE', 'FEMALE'])),
        medicalConditions: optionalOf(z.array(z.string().min(1).max(80)).max(10)),
      }),
    ),
    // Ids, not names. The old string pair was ambiguous - ten city names
    // appear under more than one district - and it made the API's filter and
    // its ranking compare the same thing with different rules.
    location: optionalOf(
      z.object({
        districtId: optionalOf(z.number().int().positive()),
        cityId: optionalOf(z.number().int().positive()),
      }),
    ),
    // Where distances are measured from, when it is not the searched city:
    // the visitor's device ("Use my location", rounded before it is sent) or,
    // for a signed-in client, their profile city. Never stored.
    origin: optionalOf(
      z.object({
        latitude: optionalOf(z.number().min(-90).max(90)),
        longitude: optionalOf(z.number().min(-180).max(180)),
        cityId: optionalOf(z.number().int().positive()),
      }),
    ),
    // How far from the origin a caregiver may live (or travel to) and still match.
    radiusKm: optionalOf(z.number().int().min(1).max(MAX_SEARCH_RADIUS_KM)),
    // Only selects which name column the response renders. Never a filter.
    locale: optionalOf(z.enum(LOCALES)),
    caregiverGenderPreference: optionalOf(z.enum(genderPreferenceValues)),
    mandatorySkillIds: optionalOf(z.array(z.string().uuid()).max(15)),
    optionalSkillIds: optionalOf(z.array(z.string().uuid()).max(15)),
    languageIds: optionalOf(z.array(z.string().uuid()).max(10)),
    // What kind of care is needed (home shifts, live-in, hospital...). Mandatory;
    // a hard filter against what each caregiver takes on.
    careType: optionalOf(z.enum(careTypeValues)),
    shift: optionalOf(z.enum(shiftRequirementValues)),
    desiredStartDate: optionalOf(z.string().date()),
    minimumExperienceYears: optionalOf(z.number().int().min(0).max(50)),
    page: optionalOf(z.number().int().min(1).max(1000)),
    pageSize: optionalOf(z.number().int().min(1).max(50)),
  })
  .superRefine((data, ctx) => {
    if (!data.careType) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['careType'], message: 'required' });
    }
    if (!data.location?.districtId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['location', 'districtId'], message: 'required' });
    }
    // Mandatory ahead of the availability feature that will consume it. The
    // API accepts and validates it today but does not yet filter or rank on
    // it - see PublicSearchService, which never reads this field.
    if (!data.desiredStartDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['desiredStartDate'], message: 'required' });
    }
  });
export type SearchRequest = z.infer<typeof searchRequestSchema>;

/**
 * The natural-language box in AI Search mode. Deliberately short minimum: a
 * bare "Galle" is a usable start - the assistant asks for whatever is missing
 * rather than refusing to begin.
 */
export const aiSearchRequestSchema = z.object({
  query: z.string().min(2).max(1000),
});
export type AiSearchRequest = z.infer<typeof aiSearchRequestSchema>;

/** Inputs a search cannot run without, which the AI assistant asks for when the description did not give them. */
export const aiMissingFieldValues = ['careType', 'location'] as const;
export type AiMissingField = (typeof aiMissingFieldValues)[number];

/** Inputs the AI filled in with a sensible default instead of asking (shown to the visitor, editable). */
export const aiAssumedFieldValues = ['desiredStartDate'] as const;
export type AiAssumedField = (typeof aiAssumedFieldValues)[number];

/** What the AI extraction step produces — same shape as SearchRequest, plus
 * an echo layer so the UI can show "here's what we understood" next to the
 * results, ask for anything still missing, and let the guardian adjust it. */
export interface ExtractedRequirements {
  requirements: SearchRequest;
  /** Human-readable summary lines for the "extracted requirements" panel,
   * grouped the way the UI displays them (Patient / Location / Care / Preferences). */
  summary: {
    patient: string[];
    location: string[];
    care: string[];
    preferences: string[];
  };
  /** Public AI Search only: required inputs still unknown - the assistant asks for these before searching. */
  missing?: AiMissingField[];
  /** Public AI Search only: required inputs defaulted rather than asked (e.g. start date -> today). */
  assumed?: AiAssumedField[];
}

export interface PublicSkillMatch {
  id: string;
  name: string;
}

export interface PublicLanguageMatch {
  name: string;
  proficiency: string;
}

export interface PublicAvailability {
  dayDuty: boolean;
  nightDuty: boolean;
  liveIn24h: boolean;
  preferredShift: ShiftRequirement;
  availableFrom: string | null;
}

/** One search result / result card. Only ever built field-by-field from an
 * explicit allow-list on the API side — never spread from the internal
 * caregiver entity. */
export interface PublicCaregiverSummary {
  publicId: string;
  gender: 'MALE' | 'FEMALE' | 'OTHER';
  approxAge: number;
  yearsExperience: number;
  district: string | null;
  city: string | null;
  districtId: number | null;
  cityId: number | null;
  preferredLocations: string[];
  languages: PublicLanguageMatch[];
  skills: PublicSkillMatch[];
  availability: PublicAvailability;
  hasVerifiedQualification: boolean;
  /** The caregiver has passed the platform's own checks (status Verified or Active). */
  verified: boolean;
  /** The kinds of care this caregiver takes on. */
  careTypes: CareType[];
  qualificationSummary: string[];
  relevantExperienceSummary: string[];
  /** Centre of the caregiver's city (or district when no city is on record) - never an address. */
  homeLocation: CaregiverHomeLocation | null;
  /** Straight-line km from the search origin to `homeLocation`. Null outside a search, or with no origin. */
  distanceKm: number | null;
  /** The cities the caregiver will travel to, with their distance from the search origin. */
  serviceArea: ServiceAreaCity[];
  /** Why this caregiver is within the search radius: they live there, or they travel there. */
  reach?: 'home' | 'serviceArea' | null;
  /** Present only in search results, absent on a profile fetched directly. */
  matchScore?: number;
  /** Short, factual reasons — never subjective claims. Generated
   * deterministically from which filters/preferences actually matched. */
  matchReasons?: string[];
  /** AI Search only: the model's one-line explanation of why this caregiver fits, in the visitor's language. */
  aiReason?: string;
}

/** Full public profile preview — a superset of the summary shape today,
 * kept as a separate type since profile and result-card fields are
 * expected to diverge (e.g. a longer relevant-experience list). */
export type PublicCaregiverProfile = Omit<PublicCaregiverSummary, 'matchScore' | 'matchReasons' | 'aiReason' | 'reach'>;

export interface PublicSearchResponse {
  items: PublicCaregiverSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  /** Where distances were measured from. Null when the search had no location at all. */
  origin?: SearchOrigin | null;
  /** Every matching caregiver (not just this page), grouped by where they live, as counts. */
  mapPoints?: MapCityPoint[];
}

export interface PublicMetaSkill {
  id: string;
  name: string;
  category: string | null;
}

export interface PublicMetaLanguage {
  id: string;
  name: string;
}

export interface PublicMetaDistrict {
  id: number;
  name: string;
}

export interface PublicMetaProvince {
  id: number;
  name: string;
  districts: PublicMetaDistrict[];
}

/** The whole province -> district shape. 34 rows, so it is worth caching
 * whole; the cities underneath it are not. */
export type PublicLocationTree = PublicMetaProvince[];

export interface PublicMetaCity {
  id: number;
  name: string;
  /** The handful of cities the source data qualifies with a second name. */
  subName: string | null;
  postcode: string | null;
  latitude: number;
  longitude: number;
}

/** Drives whether the frontend shows the AI Search tab at all — admin
 * configurable server-side, never hard-coded on the frontend. */
export interface PublicSearchConfig {
  aiSearchEnabled: boolean;
}

/** POST /public/ai/extract - the visitor's own words, and the language to answer in. */
export interface AiExtractRequest {
  query: string;
  locale?: Locale;
}

/** POST /public/ai/search - the (possibly edited) requirements plus the original words, for re-ranking. */
export interface AiSearchRequestBody {
  request: SearchRequest;
  query: string;
}

/** An AI Search response says whether the model actually re-ranked it, so the UI never overclaims. */
export interface AiSearchResponse extends PublicSearchResponse {
  aiRanked: boolean;
}
