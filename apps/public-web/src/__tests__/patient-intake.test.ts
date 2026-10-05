import { guardianFieldsCheck, makePatientIntakeSchema, toIntakePayload } from '@/lib/schemas/patient-intake';

// The raw key is fine here: these tests assert which rule fires, not the wording.
const t = (key: string) => key;

const complete = {
  registrantType: 'GUARDIAN',
  recipientName: 'Sunil Fernando',
  recipientRelationship: 'PARENT',
  recipientAge: '78',
  recipientGender: 'MALE',
  alternatePhone: '',
  preferredContactMethod: 'PHONE_CALL',
  preferredContactTime: 'ANYTIME',
  districtId: '1',
  cityId: '340',
  careAddress: '',
  careNeeds: 'Needs help with bathing and meals.',
  careSchedule: 'DAY',
  careStart: 'WITHIN_WEEK',
  preferredCaregiverGender: 'NO_PREFERENCE',
};

function schema(allowEmailContact = true) {
  return makePatientIntakeSchema(t, { allowEmailContact }).superRefine(guardianFieldsCheck(t));
}

function messages(input: unknown, allowEmailContact = true): string[] {
  const result = schema(allowEmailContact).safeParse(input);
  return result.success ? [] : result.error.issues.map((i) => i.message);
}

describe('patient intake schema', () => {
  it('accepts a complete guardian registration, turning the select strings into numbers', () => {
    const result = schema().safeParse(complete);
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.recipientAge).toBe(78);
      expect(result.data.districtId).toBe(1);
      expect(result.data.cityId).toBe(340);
    }
  });

  it('treats a blank age as missing rather than as 0', () => {
    expect(messages({ ...complete, recipientAge: '' })).toContain('patientIntake.validation.age.required');
  });

  it.each(['-1', '121', '7.5'])('rejects the age %s', (age) => {
    expect(messages({ ...complete, recipientAge: age })).toContain('patientIntake.validation.age.invalid');
  });

  it('requires a place: an unchosen district or city ("") is rejected', () => {
    const errors = messages({ ...complete, districtId: '', cityId: '' });
    expect(errors).toContain('patientIntake.validation.district');
    expect(errors).toContain('patientIntake.validation.city');
  });

  it('requires the care description to say something', () => {
    expect(messages({ ...complete, careNeeds: '' })).toContain('patientIntake.validation.careNeeds.required');
    expect(messages({ ...complete, careNeeds: 'help' })).toContain('patientIntake.validation.careNeeds.invalid');
  });

  it('asks a guardian for the recipient and relationship, but not someone registering for themselves', () => {
    const guardian = messages({ ...complete, recipientName: '', recipientRelationship: '' });
    expect(guardian).toContain('patientIntake.validation.recipientName');
    expect(guardian).toContain('patientIntake.validation.relationship');

    expect(messages({ ...complete, registrantType: 'SELF', recipientName: '', recipientRelationship: '' })).toEqual([]);
  });

  it('offers email as a contact method only where there is an email address', () => {
    const emailContact = { ...complete, preferredContactMethod: 'EMAIL' };
    expect(messages(emailContact, true)).toEqual([]);
    expect(messages(emailContact, false)).toContain('patientIntake.validation.contactMethod');
  });

  it('validates the alternate phone only when one is given', () => {
    expect(messages({ ...complete, alternatePhone: 'call me' })).toContain('patientIntake.validation.alternatePhone');
    expect(messages({ ...complete, alternatePhone: '+94 11 234 5678' })).toEqual([]);
  });
});

describe('toIntakePayload', () => {
  const parse = (input: unknown) => schema().parse(input);

  it('leaves out blank optional answers instead of sending empty strings', () => {
    const payload = toIntakePayload(parse(complete));
    expect(payload.alternatePhone).toBeUndefined();
    expect(payload.careAddress).toBeUndefined();
  });

  it('drops leftover recipient details when the person switched back to registering for themselves', () => {
    const payload = toIntakePayload(parse({ ...complete, registrantType: 'SELF' }));
    expect(payload.recipientName).toBeUndefined();
    expect(payload.recipientRelationship).toBeUndefined();
    expect(payload.recipientAge).toBe(78);
  });

  it('keeps the recipient for a guardian', () => {
    const payload = toIntakePayload(parse(complete));
    expect(payload).toMatchObject({ registrantType: 'GUARDIAN', recipientName: 'Sunil Fernando', recipientRelationship: 'PARENT' });
  });
});
