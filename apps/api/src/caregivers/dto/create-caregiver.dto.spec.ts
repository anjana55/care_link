import { ValidationPipe, ValidationPipeOptions } from '@nestjs/common';
import { CreateCaregiverDto } from './create-caregiver.dto';
import { RegisterCaregiverDto } from '../../auth/dto/register-caregiver.dto';

/**
 * These strings are shown verbatim to the person filling in the form, so the
 * point of this spec is that they stay human: every rejection must name the
 * field in plain English rather than falling back to a class-validator default
 * like "fullName must be longer than or equal to 2 characters". The DTO has no
 * custom validator function to unit test, so this drives it through the same
 * global ValidationPipe main.ts installs.
 */
describe('caregiver DTO validation messages', () => {
  const options: ValidationPipeOptions = { whitelist: true, transform: true, forbidNonWhitelisted: false };
  const pipe = new ValidationPipe(options);

  const validate = (body: unknown, dto: unknown = CreateCaregiverDto) =>
    pipe.transform(body, { type: 'body', metatype: dto as never });

  async function errorsFor(body: unknown, dto?: unknown): Promise<string[]> {
    try {
      await validate(body, dto);
      return [];
    } catch (err) {
      const message = (err as { response?: { message?: string | string[] } }).response?.message;
      return Array.isArray(message) ? message : [String(message)];
    }
  }

  const valid = {
    fullName: 'Nimal Perera',
    permanentAddress: '12 Temple Road, Colombo 05',
    dateOfBirth: '1990-04-12',
    gender: 'MALE',
    civilStatus: 'SINGLE',
    primaryPhone: '0771234567',
    emergencyContactName: 'Kamal Perera',
    emergencyContactNumber: '0779876543',
    emergencyContactRelationship: 'Father',
  };

  it('accepts a complete, valid payload', async () => {
    expect(await errorsFor(valid)).toEqual([]);
  });

  describe('missing mandatory fields name the field', () => {
    it.each([
      ['fullName', 'Full name is required'],
      ['permanentAddress', 'Permanent address is required'],
      ['dateOfBirth', 'Enter a valid date of birth'],
      ['gender', 'Gender is required'],
      ['civilStatus', 'Civil status is required'],
      ['primaryPhone', 'Primary phone is required'],
      ['emergencyContactName', 'Emergency contact name is required'],
      ['emergencyContactNumber', 'Emergency contact number is required'],
      ['emergencyContactRelationship', 'Relationship to this contact is required'],
    ])('an omitted %s says so in plain English', async (field, expected) => {
      const body: Record<string, unknown> = { ...valid };
      delete body[field];
      expect(await errorsFor(body)).toContain(expected);
    });
  });

  describe('present-but-invalid values explain the rule', () => {
    it('names the minimum length for a too-short full name', async () => {
      expect(await errorsFor({ ...valid, fullName: 'N' })).toEqual(['Enter a full name of at least 2 characters']);
    });

    it('names the minimum length for a too-short address', async () => {
      expect(await errorsFor({ ...valid, permanentAddress: 'abc' })).toEqual([
        'Enter an address of at least 5 characters',
      ]);
    });

    it('distinguishes a too-short phone from a missing one', async () => {
      expect(await errorsFor({ ...valid, primaryPhone: '123' })).toEqual([
        'Enter a valid phone number with at least 9 digits',
      ]);
    });

    it('asks for a description of the relationship rather than a length', async () => {
      expect(await errorsFor({ ...valid, emergencyContactRelationship: 'x' })).toEqual([
        'Describe how you are related to this contact',
      ]);
    });
  });

  it('never leaks a class-validator default for a required field', async () => {
    const body: Record<string, unknown> = { ...valid, fullName: '', primaryPhone: '' };
    const messages = await errorsFor(body);
    expect(messages).toEqual(['Full name is required', 'Primary phone is required']);
    for (const message of messages) {
      expect(message).not.toMatch(/must be a string|should not be empty/);
    }
  });

  it('treats a whitespace-only value as blank rather than as content', async () => {
    // A text input full of spaces passes a naive length check, so this is the
    // case that makes "at least 2 characters" a misleading message.
    expect(await errorsFor({ ...valid, fullName: '   ' })).toEqual(['Full name is required']);
  });

  it('reports a wrong type as a type problem, not as a missing field', async () => {
    expect(await errorsFor({ ...valid, fullName: 42 as unknown as string })).toEqual(['Full name must be text']);
  });

  it('accepts a value that is long enough only once trimmed', async () => {
    expect(await errorsFor({ ...valid, fullName: '  Nimal Perera  ' })).toEqual([]);
  });

  it('still accepts optional fields being absent', async () => {
    expect(await errorsFor(valid)).toEqual([]);
  });

  it('caps optional free-text fields with a readable limit', async () => {
    expect(await errorsFor({ ...valid, nic: '1'.repeat(21) })).toEqual(['NIC must be 20 characters or fewer']);
    expect(await errorsFor({ ...valid, passportNumber: 'P'.repeat(21) })).toEqual([
      'Passport number must be 20 characters or fewer',
    ]);
  });

  // Location arrives as ids, never as typed text: `district`, `city` and
  // `postalCode` are written by the service from the referenced rows. With
  // whitelist stripping they are silently dropped rather than stored, so a
  // client cannot desynchronise the display caches from the ids.
  describe('location is submitted as ids', () => {
    it('accepts a well-formed district/city id pair', async () => {
      expect(await errorsFor({ ...valid, districtId: 1, cityId: 340 })).toEqual([]);
    });

    it('explains a district id that is not a positive number', async () => {
      expect(await errorsFor({ ...valid, districtId: 0 })).toEqual(['District id must be a valid district']);
      // @Type(() => Number) turns a non-numeric string into NaN, which fails
      // both @IsInt and @Min, so assert the type message is among them.
      expect(await errorsFor({ ...valid, districtId: 'Colombo' as unknown as number })).toContain(
        'District id must be a number',
      );
    });

    it('explains a city id that is not a positive number', async () => {
      expect(await errorsFor({ ...valid, cityId: -1 })).toEqual(['City id must be a valid city']);
      expect(await errorsFor({ ...valid, cityId: 'Dehiwala' as unknown as number })).toContain(
        'City id must be a number',
      );
    });

    it('ignores free-text location fields a client might still send', async () => {
      // Rejection here would only push us back toward storing typed names.
      expect(
        await errorsFor({
          ...valid,
          district: 'Colombo',
          city: 'Colombo',
          postalCode: '00100',
          province: 'Western',
        }),
      ).toEqual([]);
    });
  });

  describe('self-registration adds account fields on top', () => {
    const registerBody = { ...valid, email: 'nimal@example.com', password: 'longenough1', consentAccepted: true };

    it('accepts a valid registration', async () => {
      expect(await errorsFor(registerBody, RegisterCaregiverDto)).toEqual([]);
    });

    it('rejects a malformed email in plain English', async () => {
      expect(await errorsFor({ ...registerBody, email: 'nope' }, RegisterCaregiverDto)).toEqual([
        'Enter a valid email address',
      ]);
    });

    it('states the password length rule', async () => {
      expect(await errorsFor({ ...registerBody, password: 'short' }, RegisterCaregiverDto)).toEqual([
        'Password must be at least 8 characters',
      ]);
    });

    it('requires the consent checkbox', async () => {
      expect(await errorsFor({ ...registerBody, consentAccepted: false }, RegisterCaregiverDto)).toEqual([
        'You must accept the data processing consent to register',
      ]);
    });

    it('inherits the personal-info messages unchanged', async () => {
      expect(await errorsFor({ ...registerBody, fullName: 'N' }, RegisterCaregiverDto)).toEqual([
        'Enter a full name of at least 2 characters',
      ]);
    });
  });
});
