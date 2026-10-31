import type { AiMissingField, ExtractedRequirements, SearchRequest } from './public-search';

/**
 * The rules of the AI Search conversation, shared by the public site and the
 * mobile app so both ask for the same things in the same order:
 *
 *  1. The visitor describes the care they need, in their own words.
 *  2. If the care type is missing it is asked for (never guessed), then the
 *     area; as soon as both are known, the search runs.
 *  3. Later messages add detail and re-run the search with everything said so far.
 */

/** The API's limit on the combined description. */
export const AI_QUERY_MAX = 1000;
/** The first description, and each follow-up. */
export const AI_FIRST_MAX = 800;
export const AI_REPLY_MAX = 200;

/**
 * Everything the visitor has said, one message per line, within the API's
 * 1000-character limit. The first description matters most, so when the total
 * is too long the oldest follow-ups are the ones dropped.
 */
export function combineTurns(turns: string[]): string {
  if (!turns.length) return '';
  const [first, ...rest] = turns;
  const kept = [...rest];
  let text = [first, ...kept].join('\n');
  while (text.length > AI_QUERY_MAX && kept.length) {
    kept.shift();
    text = [first, ...kept].join('\n');
  }
  return text.slice(0, AI_QUERY_MAX);
}

/** Required inputs still unknown. The API says so; older APIs did not, so fall back to looking. */
export function missingOf(extracted: ExtractedRequirements): AiMissingField[] {
  const missing: AiMissingField[] = extracted.missing
    ? [...extracted.missing]
    : extracted.requirements.location?.districtId
      ? []
      : ['location'];
  // Older APIs did not ask for the care type; it is required either way.
  if (!extracted.requirements.careType && !missing.includes('careType')) missing.unshift('careType');
  return extracted.requirements.careType ? missing.filter((m) => m !== 'careType') : missing;
}

/** Nothing about the care itself - the results are by area only, and a sentence more would rank them far better. */
export function lacksCareDetail(r: SearchRequest): boolean {
  return !r.mandatorySkillIds?.length && !r.optionalSkillIds?.length && !r.patient?.medicalConditions?.length && !r.shift;
}

/** The description gave nothing usable at all (a defaulted start date does not count) - ask more openly. */
export function understoodNothingIn(extracted: ExtractedRequirements): boolean {
  const assumedDate = extracted.assumed?.includes('desiredStartDate') ?? false;
  return Object.entries(extracted.requirements).every(
    ([key, value]) =>
      ['page', 'pageSize', 'locale'].includes(key) ||
      (key === 'desiredStartDate' && assumedDate) ||
      value === undefined ||
      (Array.isArray(value) && value.length === 0),
  );
}

export const EMPTY_AI_SUMMARY: ExtractedRequirements['summary'] = { patient: [], location: [], care: [], preferences: [] };
