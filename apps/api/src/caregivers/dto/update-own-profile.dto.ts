import { PartialType, PickType } from '@nestjs/swagger';
import { CreateCaregiverDto } from './create-caregiver.dto';

/**
 * What a caregiver may change on their own record (PATCH /caregivers/:id/profile).
 *
 * Deliberately a short allowlist rather than the staff DTO: no `primaryPhone`
 * (it is the login identifier, and changing it needs a verification step this
 * does not have), and nothing about status, verification or ownership - those
 * are not on `CreateCaregiverDto`'s picked fields at all, so the validation
 * pipe's whitelist strips them before they reach the service.
 *
 * Inherits every validator from the staff DTO, so a rejection reads the same
 * wherever the form was submitted from.
 */
export class UpdateOwnProfileDto extends PartialType(
  PickType(CreateCaregiverDto, [
    'fullName',
    'permanentAddress',
    'nic',
    'passportNumber',
    'dateOfBirth',
    'gender',
    'civilStatus',
    'heightIn',
    'weightKg',
    'secondaryPhone',
    'emergencyContactName',
    'emergencyContactNumber',
    'emergencyContactRelationship',
    'policeDivision',
    'policeStation',
    'districtId',
    'cityId',
  ] as const),
) {}
