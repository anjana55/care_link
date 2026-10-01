import { z } from 'zod';

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
 * District and desired start date are the only mandatory inputs - everything
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
    location: optionalOf(
      z.object({
        district: optionalOf(z.string().max(100)),
        city: optionalOf(z.string().max(100)),
      }),
    ),
    caregiverGenderPreference: optionalOf(z.enum(genderPreferenceValues)),
    mandatorySkillIds: optionalOf(z.array(z.string().uuid()).max(15)),
    optionalSkillIds: optionalOf(z.array(z.string().uuid()).max(15)),
    languageIds: optionalOf(z.array(z.string().uuid()).max(10)),
    shift: optionalOf(z.enum(shiftRequirementValues)),
    desiredStartDate: optionalOf(z.string().date()),
    minimumExperienceYears: optionalOf(z.number().int().min(0).max(50)),
    budget: optionalOf(
      z.object({
        dailyRate: optionalOf(z.number().positive().max(100000)),
        monthlyRate: optionalOf(z.number().positive().max(1000000)),
      }),
    ),
    page: optionalOf(z.number().int().min(1).max(1000)),
    pageSize: optionalOf(z.number().int().min(1).max(50)),
  })
  .superRefine((data, ctx) => {
    if (!data.location?.district) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['location', 'district'], message: 'required' });
    }
    // Mandatory ahead of the availability feature that will consume it. The
    // API accepts and validates it today but does not yet filter or rank on
    // it - see PublicSearchService, which never reads this field.
    if (!data.desiredStartDate) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['desiredStartDate'], message: 'required' });
    }
  });
export type SearchRequest = z.infer<typeof searchRequestSchema>;

/** The natural-language box in AI Search mode. */
export const aiSearchRequestSchema = z.object({
  query: z.string().min(10).max(1000),
});
export type AiSearchRequest = z.infer<typeof aiSearchRequestSchema>;

/** What the AI extraction step produces — same shape as SearchRequest, plus
 * a confidence/echo layer so the UI can show "here's what we understood"
 * and let the guardian correct it before the search actually runs. */
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
  preferredLocations: string[];
  languages: PublicLanguageMatch[];
  skills: PublicSkillMatch[];
  availability: PublicAvailability;
  hasVerifiedQualification: boolean;
  qualificationSummary: string[];
  relevantExperienceSummary: string[];
  /** Present only in search results, absent on a profile fetched directly. */
  matchScore?: number;
  /** Short, factual reasons — never subjective claims. Generated
   * deterministically from which filters/preferences actually matched. */
  matchReasons?: string[];
}

/** Full public profile preview — a superset of the summary shape today,
 * kept as a separate type since profile and result-card fields are
 * expected to diverge (e.g. a longer relevant-experience list). */
export type PublicCaregiverProfile = Omit<PublicCaregiverSummary, 'matchScore' | 'matchReasons'>;

export interface PublicSearchResponse {
  items: PublicCaregiverSummary[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
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

export interface PublicMetaLocation {
  id: string;
  district: string;
  city: string;
  province: string;
}

/** Drives whether the frontend shows the AI Search tab at all — admin
 * configurable server-side, never hard-coded on the frontend. */
export interface PublicSearchConfig {
  aiSearchEnabled: boolean;
}
