import { ValidationPipe, ValidationPipeOptions } from '@nestjs/common';
import { SearchRequestDto } from './search-request.dto';

/**
 * Drives the DTO through the same ValidationPipe config main.ts installs
 * globally, rather than calling the controller directly - the controller spec
 * mocks the service and so never exercises validation at all.
 *
 * District and desired start date are the only mandatory inputs; everything
 * else must stay optional, including the number fields that a browser sends
 * as `NaN`/blank. Those two failure modes are what previously made an
 * untouched form un-submittable.
 */
describe('SearchRequestDto validation', () => {
  // Mirrors main.ts useGlobalPipes.
  const options: ValidationPipeOptions = { whitelist: true, transform: true, forbidNonWhitelisted: false };
  const pipe = new ValidationPipe(options);

  const validate = (body: unknown) => pipe.transform(body, { type: 'body', metatype: SearchRequestDto });

  const minimal = { location: { district: 'Colombo' }, desiredStartDate: '2026-10-01' };

  async function errorsFor(body: unknown): Promise<string[]> {
    try {
      await validate(body);
      return [];
    } catch (err) {
      const message = (err as { response?: { message?: string | string[] } }).response?.message;
      return Array.isArray(message) ? message : [String(message)];
    }
  }

  describe('required criteria', () => {
    it('rejects an entirely empty body naming the district', async () => {
      expect(await errorsFor({})).toEqual(['location.district is required']);
    });

    it('rejects a body that omits location entirely', async () => {
      expect(await errorsFor({ desiredStartDate: '2026-10-01' })).toEqual(['location.district is required']);
    });

    it('rejects an empty location object', async () => {
      expect(await errorsFor({ location: {}, desiredStartDate: '2026-10-01' })).toEqual(['location.district is required']);
    });

    it('rejects a whitespace-only district', async () => {
      expect(await errorsFor({ location: { district: '   ' }, desiredStartDate: '2026-10-01' })).toEqual([
        'location.district is required',
      ]);
    });

    it('rejects a missing start date, naming the start date and not the district', async () => {
      expect(await errorsFor({ location: { district: 'Colombo' } })).toEqual(['desiredStartDate is required']);
    });

    it('reports only the first missing field, so a blank form is not a wall of errors', async () => {
      // District is named first; fixing it then surfaces the start date.
      expect(await errorsFor({})).toHaveLength(1);
      expect(await errorsFor({ location: { district: 'Colombo' } })).toHaveLength(1);
    });

    it('still rejects a supplied-but-malformed start date on its format', async () => {
      expect(await errorsFor({ location: { district: 'Colombo' }, desiredStartDate: 'not-a-date' })).toEqual([
        'desiredStartDate must be a valid ISO 8601 date string',
      ]);
    });
  });

  describe('everything else stays optional', () => {
    it('accepts a request carrying only district and start date', async () => {
      await expect(validate(minimal)).resolves.toMatchObject({
        location: { district: 'Colombo' },
        desiredStartDate: '2026-10-01',
      });
    });

    it('applies paging defaults when they are omitted', async () => {
      await expect(validate(minimal)).resolves.toMatchObject({ page: 1, pageSize: 20 });
    });

    // These are the shapes a browser actually submits for untouched inputs.
    // Before blankToUndefined in the shared schema, each of these produced a
    // validation error and silently blocked the search.
    it('accepts blank and NaN values for every optional field', async () => {
      const browserBlankBody = {
        ...minimal,
        patient: { age: Number.NaN, gender: '', medicalConditions: [] },
        caregiverGenderPreference: '',
        mandatorySkillIds: [],
        optionalSkillIds: [],
        languageIds: [],
        shift: '',
        minimumExperienceYears: Number.NaN,
        budget: { dailyRate: Number.NaN, monthlyRate: Number.NaN },
      };
      await expect(validate(browserBlankBody)).resolves.toBeDefined();
    });

    it('accepts an omitted city alongside a valid district', async () => {
      await expect(validate({ location: { district: 'Colombo' }, desiredStartDate: '2026-10-01' })).resolves.toBeDefined();
    });

    it('keeps genuinely invalid values rejected rather than blanking them', async () => {
      const errors = await errorsFor({ ...minimal, patient: { age: 999 } });
      expect(errors).toHaveLength(1);
      expect(errors[0]).toMatch(/age/);
    });
  });
});
