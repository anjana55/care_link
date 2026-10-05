import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { RegisterPatientDto } from '../auth/dto/register-patient.dto';
import { RegisterPatientWhatsappDto } from '../auth/dto/whatsapp-auth.dto';
import { buildPatientIntake } from './patient-profile.util';
import type { PatientProfileDto } from '../auth/dto/patient-profile.dto';
import type { Database } from '../database/database.module';

/**
 * Client intake: the fields staff rely on to call a client back and match a
 * caregiver. Driven through the same ValidationPipe main.ts installs, so the
 * messages asserted here are exactly what the registration form shows.
 */
const pipe = new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false });

async function errorsFor(body: unknown, dto: unknown): Promise<string[]> {
  try {
    await pipe.transform(body, { type: 'body', metatype: dto as never });
    return [];
  } catch (err) {
    const message = (err as { response?: { message?: string | string[] } }).response?.message;
    return Array.isArray(message) ? message : [String(message)];
  }
}

const intake = {
  registrantType: 'GUARDIAN',
  recipientName: 'Sunil Fernando',
  recipientRelationship: 'PARENT',
  recipientAge: 78,
  recipientGender: 'MALE',
  preferredContactMethod: 'PHONE_CALL',
  districtId: 1,
  cityId: 340,
  careNeeds: 'Needs help with bathing, meals and medication reminders.',
  careSchedule: 'DAY',
  careStart: 'WITHIN_WEEK',
};

const emailBody = {
  ...intake,
  fullName: 'Nadeesha Fernando',
  email: 'nadeesha@example.com',
  phone: '0771234567',
  password: 'correct-horse',
  consentAccepted: true,
};

const whatsappBody = { ...intake, fullName: 'Nadeesha Fernando', whatsappNumber: '0771234567', consentAccepted: true };

describe('patient registration DTOs', () => {
  it('accepts a complete email registration and a complete WhatsApp registration', async () => {
    expect(await errorsFor(emailBody, RegisterPatientDto)).toEqual([]);
    expect(await errorsFor(whatsappBody, RegisterPatientWhatsappDto)).toEqual([]);
  });

  it('requires a contact phone for email registrations (it used to be optional)', async () => {
    const { phone: _phone, ...withoutPhone } = emailBody;
    expect((await errorsFor(withoutPhone, RegisterPatientDto)).join(' ')).toMatch(/phone/i);
  });

  it.each([
    ['registrantType', 'Choose who needs care'],
    ['recipientAge', 'Enter the age of the person needing care'],
    ['recipientGender', 'Choose the gender of the person needing care'],
    ['preferredContactMethod', 'Choose how we should contact you'],
    ['districtId', 'Choose the district where care is needed'],
    ['cityId', 'Choose the city where care is needed'],
    ['careNeeds', 'Describe the care needed'],
    ['careSchedule', 'Choose when care is needed'],
    ['careStart', 'Choose when care should start'],
  ])('rejects a registration without %s with a plain-English message', async (field, message) => {
    const body: Record<string, unknown> = { ...whatsappBody };
    delete body[field];
    expect(await errorsFor(body, RegisterPatientWhatsappDto)).toContain(message);
  });

  it('asks a guardian who they are caring for, and how they are related', async () => {
    const { recipientName: _n, recipientRelationship: _r, ...rest } = whatsappBody;
    const errors = await errorsFor(rest, RegisterPatientWhatsappDto);
    expect(errors).toContain('Name of the person needing care is required');
    expect(errors).toContain('Choose your relationship to the person needing care');
  });

  it('does not ask a self-registrant for a care recipient', async () => {
    const { recipientName: _n, recipientRelationship: _r, ...rest } = whatsappBody;
    expect(await errorsFor({ ...rest, registrantType: 'SELF' }, RegisterPatientWhatsappDto)).toEqual([]);
  });

  it('rejects an impossible age and a too-short care description', async () => {
    const errors = await errorsFor({ ...whatsappBody, recipientAge: 200, careNeeds: 'help' }, RegisterPatientWhatsappDto);
    expect(errors).toContain('Enter a valid age');
    expect(errors).toContain('Describe the care needed in at least 10 characters');
  });

  it('rejects a malformed alternate phone but allows leaving it out', async () => {
    expect(await errorsFor({ ...whatsappBody, alternatePhone: 'call me' }, RegisterPatientWhatsappDto)).toContain(
      'Enter a valid alternate phone number',
    );
    expect(await errorsFor({ ...whatsappBody, alternatePhone: '+94 11 234 5678' }, RegisterPatientWhatsappDto)).toEqual([]);
  });
});

describe('buildPatientIntake', () => {
  /** Answers the city, district and province lookups resolveLocationRefs makes, in that order. */
  function stubDb(cityDistrictId = 1) {
    const answers = [
      [{ id: 340, districtId: cityDistrictId, nameEn: 'Dehiwala', postcode: '10350' }],
      [{ id: 1, provinceId: 1, nameEn: 'Colombo' }],
      [{ nameEn: 'Western' }],
    ];
    let call = 0;
    const chain = {
      select: () => chain,
      from: () => chain,
      where: () => chain,
      limit: () => Promise.resolve(answers[call++] ?? []),
    };
    return chain as unknown as Database;
  }

  const dto = (over: Partial<PatientProfileDto> = {}) => ({ ...intake, ...over }) as PatientProfileDto;

  it('records the care recipient for a guardian', async () => {
    const row = await buildPatientIntake(stubDb(), dto(), { hasEmail: true });
    expect(row).toMatchObject({
      registrantType: 'GUARDIAN',
      recipientName: 'Sunil Fernando',
      recipientRelationship: 'PARENT',
      districtId: 1,
      cityId: 340,
      preferredContactTime: 'ANYTIME',
      preferredCaregiverGender: 'NO_PREFERENCE',
    });
  });

  it('records no separate recipient for a self-registrant, even if one was sent', async () => {
    const row = await buildPatientIntake(stubDb(), dto({ registrantType: 'SELF' }), { hasEmail: true });
    expect(row.recipientName).toBeNull();
    expect(row.recipientRelationship).toBeNull();
  });

  it('refuses EMAIL as the contact method for an account with no email address', async () => {
    await expect(buildPatientIntake(stubDb(), dto({ preferredContactMethod: 'EMAIL' }), { hasEmail: false })).rejects.toThrow(
      BadRequestException,
    );
    await expect(
      buildPatientIntake(stubDb(), dto({ preferredContactMethod: 'EMAIL' }), { hasEmail: true }),
    ).resolves.toMatchObject({ preferredContactMethod: 'EMAIL' });
  });

  it('refuses a city that belongs to a different district', async () => {
    await expect(buildPatientIntake(stubDb(2), dto(), { hasEmail: true })).rejects.toThrow(BadRequestException);
  });
});
