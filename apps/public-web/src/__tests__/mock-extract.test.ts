import { mockExtractRequirements } from '@/lib/ai/mock-extract';
import type { PublicMetaLocation, PublicMetaSkill } from '@care-platform/shared';

const skills: PublicMetaSkill[] = [
  { id: 'skill-parkinsons', name: "Parkinson's Care", category: 'Specialized Care' },
  { id: 'skill-medication', name: 'Medication Assistance', category: 'Daily Living' },
  { id: 'skill-bathing', name: 'Bathing Assistance', category: 'Daily Living' },
];

const locations: PublicMetaLocation[] = [{ id: 'loc-colombo', district: 'Colombo', city: 'Colombo', province: 'Western' }];

describe('mockExtractRequirements', () => {
  it('extracts the exact example scenario from the brief', () => {
    const query =
      "I need a female caregiver in Colombo for my 78 year old mother who has Parkinson's. She needs night care and help with medication and bathing.";
    const { requirements, summary } = mockExtractRequirements(query, skills, locations);

    expect(requirements.patient?.age).toBe(78);
    expect(requirements.patient?.gender).toBe('FEMALE');
    expect(requirements.location?.city).toBe('Colombo');
    expect(requirements.caregiverGenderPreference).toBe('FEMALE');
    expect(requirements.shift).toBe('NIGHT');
    expect(requirements.mandatorySkillIds).toEqual(
      expect.arrayContaining(['skill-parkinsons', 'skill-medication', 'skill-bathing']),
    );
    expect(summary.patient).toContain('78 years old');
    expect(summary.patient).toContain('Female');
    expect(summary.preferences).toContain('Female caregiver');
  });

  it('never invents a location that was not mentioned', () => {
    const { requirements } = mockExtractRequirements('I need a caregiver for night care', skills, locations);
    expect(requirements.location).toBeUndefined();
  });

  it('leaves fields absent rather than guessing when the text is ambiguous', () => {
    const { requirements } = mockExtractRequirements('Looking for some help', skills, locations);
    expect(requirements.patient).toBeUndefined();
    expect(requirements.shift).toBeUndefined();
    expect(requirements.mandatorySkillIds).toBeUndefined();
  });
});
