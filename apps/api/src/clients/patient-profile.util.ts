import { BadRequestException } from '@nestjs/common';
import type { Database } from '../database/database.module';
import { resolveLocationRefs } from '../common/utils/location.util';
import type { PatientProfileDto } from '../auth/dto/patient-profile.dto';
import type { patients } from '../database/schema';

type PatientIntakeColumns = Pick<
  typeof patients.$inferInsert,
  | 'registrantType'
  | 'recipientName'
  | 'recipientRelationship'
  | 'recipientAge'
  | 'recipientGender'
  | 'alternatePhone'
  | 'preferredContactMethod'
  | 'preferredContactTime'
  | 'districtId'
  | 'cityId'
  | 'careAddress'
  | 'careNeeds'
  | 'careSchedule'
  | 'careStart'
  | 'preferredCaregiverGender'
>;

/**
 * The intake columns of the `patients` row a self-registration creates, shared
 * by the email and WhatsApp sign-up paths so the two cannot drift apart.
 *
 * Validates the parts a DTO cannot: the city must exist and belong to the
 * district, and EMAIL is only a usable contact method for accounts that have
 * an email address. Accepts a transaction handle as well as the top-level
 * Database (same convention as resolveLocationRefs).
 */
export async function buildPatientIntake(
  db: Database,
  dto: PatientProfileDto,
  opts: { hasEmail: boolean },
): Promise<PatientIntakeColumns> {
  if (dto.preferredContactMethod === 'EMAIL' && !opts.hasEmail) {
    throw new BadRequestException('Email cannot be the preferred contact method for an account without an email address');
  }

  const location = await resolveLocationRefs(db, { districtId: dto.districtId, cityId: dto.cityId });
  if (!location?.districtId || !location.cityId) {
    throw new BadRequestException('Choose both the district and the city where care is needed');
  }

  const guardian = dto.registrantType === 'GUARDIAN';
  return {
    registrantType: dto.registrantType,
    // For SELF the care recipient is the account holder, so there is nothing to record.
    recipientName: guardian ? dto.recipientName!.trim() : null,
    recipientRelationship: guardian ? dto.recipientRelationship! : null,
    recipientAge: dto.recipientAge,
    recipientGender: dto.recipientGender,
    alternatePhone: dto.alternatePhone?.trim() || null,
    preferredContactMethod: dto.preferredContactMethod,
    preferredContactTime: dto.preferredContactTime ?? 'ANYTIME',
    districtId: location.districtId,
    cityId: location.cityId,
    careAddress: dto.careAddress?.trim() || null,
    careNeeds: dto.careNeeds.trim(),
    careSchedule: dto.careSchedule,
    careStart: dto.careStart,
    preferredCaregiverGender: dto.preferredCaregiverGender ?? 'NO_PREFERENCE',
  };
}
