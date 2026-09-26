import type { ExtractedRequirements, PublicMetaLocation, PublicMetaSkill, SearchRequest } from '@care-platform/shared';

/**
 * STAND-IN ONLY. The real extraction step belongs server-side, calling an
 * admin-configured AI provider (Ollama first) per the agreed architecture -
 * that pipeline is explicitly out of scope for this phase. This module
 * exists purely so the AI Search UI (natural language -> editable
 * structured requirements -> search) is genuinely wired up and testable
 * end to end, using simple keyword matching instead of a model.
 *
 * The panel that calls this stays disabled unless the backend's
 * `/public/meta/search-config` reports `aiSearchEnabled: true` - so this
 * mock is never reachable by a real anonymous user until a real AI backend
 * is actually behind it.
 */
export function mockExtractRequirements(
  query: string,
  skills: PublicMetaSkill[],
  locations: PublicMetaLocation[],
): ExtractedRequirements {
  const lower = query.toLowerCase();

  const requirements: SearchRequest = { page: 1, pageSize: 20 };
  const summary: ExtractedRequirements['summary'] = { patient: [], location: [], care: [], preferences: [] };

  const ageMatch = lower.match(/(\d{1,3})\s*(?:years?|yrs?|year[-\s]old)/);
  if (ageMatch) {
    const age = Number(ageMatch[1]);
    requirements.patient = { ...requirements.patient, age };
    summary.patient.push(`${age} years old`);
  }

  if (/\bmother\b|\bwife\b|\bgrandmother\b|\bshe\b|\bher\b|\bfemale patient\b/.test(lower)) {
    requirements.patient = { ...requirements.patient, gender: 'FEMALE' };
    summary.patient.push('Female');
  } else if (/\bfather\b|\bhusband\b|\bgrandfather\b|\bhe\b|\bhis\b|\bmale patient\b/.test(lower)) {
    requirements.patient = { ...requirements.patient, gender: 'MALE' };
    summary.patient.push('Male');
  }

  // Location: match against known city/district names rather than guessing.
  for (const loc of locations) {
    if (lower.includes(loc.city.toLowerCase())) {
      requirements.location = { ...requirements.location, city: loc.city, district: loc.district };
      summary.location.push(loc.city);
      break;
    }
    if (lower.includes(loc.district.toLowerCase()) && !requirements.location?.district) {
      requirements.location = { ...requirements.location, district: loc.district };
      summary.location.push(loc.district);
    }
  }

  // Skills / conditions: match query text against known skill names -
  // covers both "help with medication" (skill) and "Parkinson's" (a skill
  // that also functions as a care-type / medical-condition term here).
  const matchedSkillIds: string[] = [];
  const conditions: string[] = [];
  for (const skill of skills) {
    const needle = skill.name.toLowerCase().replace(' assistance', '').replace(' care', '');
    if (lower.includes(needle)) {
      matchedSkillIds.push(skill.id);
      summary.care.push(skill.name);
      if (needle.includes("parkinson") || needle.includes('dementia') || needle.includes('diabetes')) {
        conditions.push(skill.name.replace(' Care', ''));
      }
    }
  }
  if (matchedSkillIds.length) requirements.mandatorySkillIds = matchedSkillIds;
  if (conditions.length) {
    requirements.patient = { ...requirements.patient, medicalConditions: conditions };
  }

  if (/\bnight\b/.test(lower)) {
    requirements.shift = 'NIGHT';
    summary.care.push('Night care');
  } else if (/\blive[-\s]?in\b|\b24[-\s]?hour\b/.test(lower)) {
    requirements.shift = 'TWENTY_FOUR_HOUR_LIVE_IN';
    summary.care.push('24-hour live-in');
  } else if (/\bday\b/.test(lower)) {
    requirements.shift = 'DAY';
    summary.care.push('Day care');
  }

  if (/\bfemale caregiver\b|\bfemale carer\b|\bwoman caregiver\b/.test(lower)) {
    requirements.caregiverGenderPreference = 'FEMALE';
    summary.preferences.push('Female caregiver');
  } else if (/\bmale caregiver\b|\bmale carer\b|\bman caregiver\b/.test(lower)) {
    requirements.caregiverGenderPreference = 'MALE';
    summary.preferences.push('Male caregiver');
  }

  return { requirements, summary };
}
