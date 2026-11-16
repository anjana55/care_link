import { onboardingFile, profileGaps, referenceState, type OnboardingFacts } from '@care-platform/shared';

const profile: OnboardingFacts['profile'] = {
  dateOfBirth: '1988-01-20', permanentAddress: '1 Lake Road', nic: '881234567V', passportNumber: null, districtId: 3, emergencyContactName: 'EC', emergencyContactNumber: '0770001111',
};
const docs = (status = 'PENDING') => [
  { type: 'NIC', status, expiresOn: null },
  { type: 'POLICE_CLEARANCE', status, expiresOn: '2027-06-01' },
  { type: 'GRAMA_NILADHARI_CERTIFICATE', status, expiresOn: null },
];
const yes = { status: 'IN_PROGRESS', sentAt: '2026-11-01T00:00:00Z', answer: { knowsThem: true, years: 'OVER_3' as const, wouldTrust: 'YES' as const, answeredAt: '2026-11-02T00:00:00Z' } };
const facts = (over: Partial<OnboardingFacts> = {}): OnboardingFacts => ({ today: '2026-11-16', documents: docs(), profile, references: [yes, yes], ...over });

describe('onboarding rules', () => {
  it('is ready once every document is in, the profile complete and two referees have confirmed', () => {
    const f = onboardingFile(facts());
    expect(f.recommendation).toBe('READY');
    expect(f.missingDocuments).toEqual([]);
    expect(f.checks.map((c) => `${c.key}:${c.state}`)).toEqual(['IDENTITY:TO_CHECK', 'POLICE:TO_CHECK', 'GN:TO_CHECK', 'PROFILE:OK', 'REFERENCES:OK']);
    expect(onboardingFile(facts({ documents: docs('VERIFIED') })).checks[0].state).toBe('OK');
  });

  it('asks for missing, expired and rejected documents, and is not ready without them', () => {
    const f = onboardingFile(facts({ documents: [{ type: 'PASSPORT', status: 'PENDING', expiresOn: '2026-11-15' }, { type: 'POLICE_CLEARANCE', status: 'REJECTED', expiresOn: null }] }));
    expect(f.checks.slice(0, 3).map((c) => c.state)).toEqual(['EXPIRED', 'REJECTED', 'MISSING']);
    expect(f.missingDocuments).toEqual(['identity', 'police', 'gn']);
    expect(f.recommendation).toBe('NOT_READY');
    // A newer, valid upload replaces an expired one.
    expect(onboardingFile(facts({ documents: [...docs(), { type: 'NIC', status: 'PENDING', expiresOn: '2020-01-01' }] })).missingDocuments).toEqual([]);
  });

  it('names the profile gaps', () => {
    expect(profileGaps({ ...profile, dateOfBirth: null, nic: ' ', districtId: null, emergencyContactNumber: null })).toEqual(['DATE_OF_BIRTH', 'ID_NUMBER', 'AREA', 'EMERGENCY_CONTACT']);
    expect(profileGaps({ ...profile, nic: null, passportNumber: 'N123' })).toEqual([]);
    expect(onboardingFile(facts({ profile: { ...profile, permanentAddress: '' } })).checks[3]).toEqual({ key: 'PROFILE', state: 'MISSING', gaps: ['ADDRESS'] });
  });

  it('counts referees: confirmed, waiting, too few, or a concern', () => {
    const waiting = { status: 'IN_PROGRESS', sentAt: '2026-11-10T00:00:00Z', answer: null };
    expect(onboardingFile(facts({ references: [yes, waiting] })).checks[4]).toEqual({ key: 'REFERENCES', state: 'WAITING', confirmed: 1, wanted: 2 });
    expect(onboardingFile(facts({ references: [yes] })).checks[4].state).toBe('MISSING');
    expect(onboardingFile(facts({ references: [yes, { status: 'VERIFIED', sentAt: null, answer: null }] })).recommendation).toBe('READY');
    const no = { ...yes, answer: { knowsThem: true, years: 'UNDER_1' as const, wouldTrust: 'NO' as const, answeredAt: yes.answer.answeredAt } };
    expect(onboardingFile(facts({ references: [yes, yes, no] })).recommendation).toBe('CONCERNS');
    expect(referenceState({ status: 'PENDING', sentAt: null, answer: { knowsThem: false, answeredAt: 'x' } })).toBe('CONCERN');
    expect(referenceState({ status: 'REJECTED', sentAt: null, answer: null })).toBe('CONCERN');
    expect(referenceState({ status: 'PENDING', sentAt: null, answer: null })).toBe('NOT_ASKED');
  });
});
