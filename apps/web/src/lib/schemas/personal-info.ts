import { z } from 'zod';

export type PersonalInfoValues = z.infer<ReturnType<typeof makePersonalInfoSchema>>;

const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const;
const CIVIL_STATUSES = ['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'OTHER'] as const;

export function makePersonalInfoSchema(t: (key: string) => string) {
  const required = (field: string) => t(`personalInfo.validation.${field}.required`);
  const invalid = (field: string) => t(`personalInfo.validation.${field}.invalid`);

  return z.object({
    fullName: z.string().trim().min(1, required('fullName')).min(2, invalid('fullName')),
    permanentAddress: z.string().trim().min(1, required('permanentAddress')).min(5, invalid('permanentAddress')),
    nic: z.string().trim().optional(),
    passportNumber: z.string().trim().optional(),
    dateOfBirth: z.string().min(1, required('dateOfBirth')),
    // Native selects can only ever submit '' or a valid member, so a single
    // message is accurate for both and the enum type is preserved.
    gender: z.enum(GENDERS, { errorMap: () => ({ message: required('gender') }) }),
    civilStatus: z.enum(CIVIL_STATUSES, { errorMap: () => ({ message: required('civilStatus') }) }),
    heightIn: z.coerce.number().optional(),
    weightKg: z.coerce.number().optional(),
    primaryPhone: z.string().trim().min(1, required('primaryPhone')).min(9, invalid('primaryPhone')),
    secondaryPhone: z.string().trim().optional(),
    emergencyContactName: z.string().trim().min(1, required('emergencyContactName')).min(2, invalid('emergencyContactName')),
    emergencyContactNumber: z.string().trim().min(1, required('emergencyContactNumber')).min(9, invalid('emergencyContactNumber')),
    emergencyContactRelationship: z.string().trim().min(1, required('emergencyContactRelationship')).min(2, invalid('emergencyContactRelationship')),
    policeDivision: z.string().trim().optional(),
    policeStation: z.string().trim().optional(),
    district: z.string().trim().min(1, required('district')),
    city: z.string().trim().min(1, required('city')),
    postalCode: z.string().trim().min(1, required('postalCode')),
  });
}

/**
 * The field names the schema actually enforces, so a form can mark its
 * mandatory fields without a hand-kept list drifting away from the rules.
 * Callers that wrap this schema in .refine() get a ZodEffects with no .shape,
 * so pass the underlying object schema, not the refined one.
 */
export function requiredFieldsOf(schema: z.ZodObject<z.ZodRawShape>): ReadonlySet<string> {
  const required = new Set<string>();
  for (const [name, field] of Object.entries(schema.shape)) {
    if (!field.isOptional()) required.add(name);
  }
  return required;
}
