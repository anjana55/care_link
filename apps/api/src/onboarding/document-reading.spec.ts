import { compareReading, nameMatch, nicDigits, onboardingFile, type DocumentRead, type OnboardingFacts } from '@care-platform/shared';
import { parseDocumentRead } from './onboarding-agent.service';

const profile = { fullName: 'Kamala Perera', nic: '881234567V', passportNumber: 'N1234567', dateOfBirth: '1988-01-20' };
const read = (over: Partial<DocumentRead> = {}): DocumentRead => ({ legible: true, documentType: 'NIC', fullName: 'W.M. KAMALA PERERA', idNumber: '198812304567', dateOfBirth: '1988-01-20', expiresOn: null, ...over });
const TODAY = '2026-11-16';

describe('reading a document', () => {
  it('matches names by whole words, initials and order aside', () => {
    expect(nameMatch('W.M. KAMALA PERERA', 'Kamala Perera')).toBe('MATCH');
    expect(nameMatch('Perera Kamala', 'Kamala Perera')).toBe('MATCH');
    expect(nameMatch('Kamala Silva', 'Kamala Perera')).toBe('PARTIAL');
    expect(nameMatch('Nimal Bandara', 'Kamala Perera')).toBe('MISMATCH');
  });

  it('treats an old and a new NIC number for the same person as one', () => {
    expect(nicDigits('881234567V')).toBe('198812304567');
    expect(nicDigits('198812304567')).toBe('198812304567');
    expect(nicDigits('88123 4567 v')).toBe('198812304567');
  });

  it('is OK when everything shown matches the profile', () => {
    const r = compareReading(read(), { type: 'NIC' }, profile, TODAY);
    expect(r).toEqual({ outcome: 'OK', checks: [{ check: 'TYPE', result: 'MATCH' }, { check: 'NAME', result: 'MATCH' }, { check: 'ID_NUMBER', result: 'MATCH' }, { check: 'DATE_OF_BIRTH', result: 'MATCH' }], expiresOn: null });
  });

  it('flags a different number, an expired document, an unreadable one, and asks staff to check what is not shown', () => {
    expect(compareReading(read({ idNumber: '199012345678' }), { type: 'NIC' }, profile, TODAY).outcome).toBe('MISMATCH');
    expect(compareReading(read({ documentType: 'PASSPORT' }), { type: 'NIC' }, profile, TODAY).outcome).toBe('MISMATCH');
    const passport = compareReading(read({ documentType: 'PASSPORT', idNumber: 'n 1234567', expiresOn: '2026-01-01' }), { type: 'PASSPORT' }, profile, TODAY);
    expect(passport.outcome).toBe('EXPIRED');
    expect(passport.checks).toContainEqual({ check: 'ID_NUMBER', result: 'MATCH' });
    expect(compareReading(read({ legible: false }), { type: 'NIC' }, profile, TODAY)).toEqual({ outcome: 'UNREADABLE', checks: [], expiresOn: null });
    expect(compareReading(null, { type: 'NIC' }, profile, TODAY).outcome).toBe('UNREADABLE');
    const police = compareReading(read({ documentType: 'POLICE_CLEARANCE', idNumber: null, dateOfBirth: null, fullName: null, expiresOn: '2027-03-01' }), { type: 'POLICE_CLEARANCE' }, profile, TODAY);
    expect(police).toEqual({ outcome: 'CHECK', checks: [{ check: 'TYPE', result: 'MATCH' }, { check: 'NAME', result: 'NOT_SHOWN' }, { check: 'EXPIRY', result: 'VALID' }], expiresOn: '2027-03-01' });
  });

  it("checks the model's answer field by field", () => {
    expect(parseDocumentRead('```json\n{"legible":true,"documentType":"NIC","fullName":"Kamala","idNumber":"881234567V","dateOfBirth":"20/01/1988","expiresOn":"2030-01-01"}\n```')).toEqual({
      legible: true, documentType: 'NIC', fullName: 'Kamala', idNumber: '881234567V', dateOfBirth: null, expiresOn: '2030-01-01',
    });
    expect(parseDocumentRead('{"documentType":"NIC"}')).toBeNull();
    expect(parseDocumentRead('{"legible":true,"documentType":"DRIVING_LICENCE"}')?.documentType).toBeNull();
    expect(parseDocumentRead('not json')).toBeNull();
  });

  it('feeds the file: unreadable asks for a clearer copy; a mismatch is a concern; read as expired is expired', () => {
    const base: OnboardingFacts = {
      today: TODAY,
      documents: [{ type: 'POLICE_CLEARANCE', status: 'PENDING', expiresOn: null }, { type: 'GRAMA_NILADHARI_CERTIFICATE', status: 'PENDING', expiresOn: null }],
      profile: { dateOfBirth: '1988-01-20', permanentAddress: 'x', nic: 'x', passportNumber: null, districtId: 1, emergencyContactName: 'x', emergencyContactNumber: 'x' },
      references: [],
    };
    const withNic = (reading: 'OK' | 'MISMATCH' | 'UNREADABLE' | 'EXPIRED' | null) => onboardingFile({ ...base, documents: [...base.documents, { type: 'NIC', status: 'PENDING', expiresOn: null, reading }] });
    expect(withNic('UNREADABLE').checks[0].state).toBe('UNCLEAR');
    expect(withNic('UNREADABLE').missingDocuments).toEqual(['identity']);
    expect(withNic('MISMATCH').checks[0].state).toBe('CONCERN');
    expect(withNic('MISMATCH').recommendation).toBe('CONCERNS');
    expect(withNic('EXPIRED').checks[0].state).toBe('EXPIRED');
    expect(withNic('OK').checks[0].state).toBe('TO_CHECK');
    expect(withNic(null).checks[0].state).toBe('TO_CHECK');
  });
});
