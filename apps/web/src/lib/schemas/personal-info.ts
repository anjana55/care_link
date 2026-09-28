import { z } from 'zod';
import type { Locale } from '@/lib/i18n/provider';

export type PersonalInfoValues = z.infer<ReturnType<typeof makePersonalInfoSchema>>;

export function makePersonalInfoSchema(t: (key: string) => string) {
  return z.object({
    fullName: z.string().min(2, t('personalInfo.validation.fullName')),
    permanentAddress: z.string().min(5, t('personalInfo.validation.permanentAddress')),
    nic: z.string().optional(),
    passportNumber: z.string().optional(),
    dateOfBirth: z.string().min(1, t('personalInfo.validation.dateOfBirth')),
    gender: z.enum(['MALE', 'FEMALE', 'OTHER']),
    civilStatus: z.enum(['SINGLE', 'MARRIED', 'DIVORCED', 'WIDOWED', 'OTHER']),
    heightCm: z.coerce.number().optional(),
    weightKg: z.coerce.number().optional(),
    primaryPhone: z.string().min(9, t('personalInfo.validation.primaryPhone')),
    secondaryPhone: z.string().optional(),
    emergencyContactName: z.string().min(2, t('personalInfo.validation.emergencyContactName')),
    emergencyContactNumber: z.string().min(9, t('personalInfo.validation.emergencyContactNumber')),
    emergencyContactRelationship: z.string().min(2, t('personalInfo.validation.emergencyContactRelationship')),
    policeDivision: z.string().optional(),
    policeStation: z.string().optional(),
    district: z.string().min(1, t('personalInfo.validation.district')),
    city: z.string().min(1, t('personalInfo.validation.city')),
    postalCode: z.string().min(1, t('personalInfo.validation.postalCode')),
  });
}