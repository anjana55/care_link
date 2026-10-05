import { z } from 'zod';

/**
 * The care intake both client sign-ups ask for (email and WhatsApp), mirroring
 * apps/api's PatientProfileDto field for field. Kept in one place so the two
 * pages cannot drift apart, and so the rules the API enforces are the rules
 * the form shows.
 */
export const REGISTRANT_TYPES = ['SELF', 'GUARDIAN'] as const;
export const RELATIONSHIPS = ['PARENT', 'SPOUSE', 'CHILD', 'SIBLING', 'OTHER_RELATIVE', 'FRIEND', 'OTHER'] as const;
export const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
export const CONTACT_METHODS = ['PHONE_CALL', 'WHATSAPP', 'EMAIL'] as const;
export const CONTACT_TIMES = ['ANYTIME', 'MORNING', 'AFTERNOON', 'EVENING'] as const;
export const CARE_SCHEDULES = ['DAY', 'NIGHT', 'LIVE_IN_24H', 'NOT_SURE'] as const;
export const CARE_STARTS = ['IMMEDIATELY', 'WITHIN_WEEK', 'WITHIN_MONTH', 'JUST_EXPLORING'] as const;
export const CAREGIVER_GENDER_PREFERENCES = ['NO_PREFERENCE', 'MALE', 'FEMALE'] as const;

/** Same pattern as the API's alternatePhone rule. */
const PHONE_PATTERN = /^\+?[\d\s\-()]{7,20}$/;

/**
 * A number input submits a string, and a blank one is '' - "not answered", not 0.
 * Done by hand rather than with z.coerce, which would turn the undefined into
 * NaN and report the "invalid" message for a field that is simply empty.
 */
const numberOrUndefined = (v: unknown) => (v === '' || v === null || v === undefined ? undefined : Number(v));

export function makePatientIntakeSchema(t: (key: string) => string, opts: { allowEmailContact: boolean }) {
  const v = (key: string) => t(`patientIntake.validation.${key}`);
  const chooseOne = (key: string) => ({ errorMap: () => ({ message: v(key) }) });

  return z.object({
    registrantType: z.enum(REGISTRANT_TYPES, chooseOne('registrantType')),
    // Only meaningful for GUARDIAN; enforced by guardianFieldsCheck below.
    recipientName: z.string().trim().optional(),
    recipientRelationship: z.union([z.enum(RELATIONSHIPS), z.literal('')]).optional(),
    recipientAge: z.preprocess(
      numberOrUndefined,
      z
        .number({ required_error: v('age.required'), invalid_type_error: v('age.invalid') })
        .int(v('age.invalid'))
        .min(0, v('age.invalid'))
        .max(120, v('age.invalid')),
    ),
    recipientGender: z.enum(GENDERS, chooseOne('recipientGender')),
    alternatePhone: z
      .string()
      .trim()
      .optional()
      .refine((val) => !val || PHONE_PATTERN.test(val), v('alternatePhone')),
    preferredContactMethod: z
      .enum(CONTACT_METHODS, chooseOne('contactMethod'))
      .refine((m) => opts.allowEmailContact || m !== 'EMAIL', v('contactMethod')),
    preferredContactTime: z.enum(CONTACT_TIMES, chooseOne('contactTime')),
    districtId: z.coerce.number().int().positive(v('district')),
    cityId: z.coerce.number().int().positive(v('city')),
    careAddress: z.string().trim().max(500).optional(),
    careNeeds: z.string().trim().min(1, v('careNeeds.required')).min(10, v('careNeeds.invalid')).max(1000, v('careNeeds.invalid')),
    careSchedule: z.enum(CARE_SCHEDULES, chooseOne('careSchedule')),
    careStart: z.enum(CARE_STARTS, chooseOne('careStart')),
    preferredCaregiverGender: z.enum(CAREGIVER_GENDER_PREFERENCES, chooseOne('caregiverGender')),
  });
}

export type PatientIntakeValues = z.infer<ReturnType<typeof makePatientIntakeSchema>>;

/**
 * A guardian must say who they are arranging care for; someone registering for
 * themselves must not be asked. Pass to .superRefine() on the finished schema -
 * it is a refinement rather than part of the object so callers can still
 * .extend() the object with their own fields first.
 */
export function guardianFieldsCheck(t: (key: string) => string) {
  return (
    data: { registrantType?: string; recipientName?: string; recipientRelationship?: string },
    ctx: z.RefinementCtx,
  ) => {
    if (data.registrantType !== 'GUARDIAN') return;
    if (!data.recipientName || data.recipientName.trim().length < 2) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['recipientName'], message: t('patientIntake.validation.recipientName') });
    }
    if (!data.recipientRelationship) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['recipientRelationship'], message: t('patientIntake.validation.relationship') });
    }
  };
}

/**
 * The intake half of the registration request body. Blank optional answers are
 * left out rather than sent as '', and a self-registrant's leftover recipient
 * fields (typed, then switched back to "myself") are dropped.
 */
export function toIntakePayload(values: PatientIntakeValues) {
  const guardian = values.registrantType === 'GUARDIAN';
  return {
    registrantType: values.registrantType,
    recipientName: guardian ? values.recipientName?.trim() : undefined,
    recipientRelationship: guardian && values.recipientRelationship ? values.recipientRelationship : undefined,
    recipientAge: values.recipientAge,
    recipientGender: values.recipientGender,
    alternatePhone: values.alternatePhone || undefined,
    preferredContactMethod: values.preferredContactMethod,
    preferredContactTime: values.preferredContactTime,
    districtId: values.districtId,
    cityId: values.cityId,
    careAddress: values.careAddress || undefined,
    careNeeds: values.careNeeds,
    careSchedule: values.careSchedule,
    careStart: values.careStart,
    preferredCaregiverGender: values.preferredCaregiverGender,
  };
}
