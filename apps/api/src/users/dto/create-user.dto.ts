import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsString, MinLength } from 'class-validator';

// CAREGIVER accounts are deliberately excluded here: they're created only
// through the self-registration flow (POST /auth/register-caregiver), which
// also creates the linked caregivers record in the same transaction.
// Creating a bare CAREGIVER-role user through this admin endpoint would
// leave a login with no profile behind it.
export const STAFF_MANAGEABLE_ROLES = ['ADMIN', 'STAFF', 'VERIFIER'] as const;

export class CreateUserDto {
  @ApiProperty()
  @IsEmail()
  email: string;

  @ApiProperty()
  @IsString()
  @MinLength(8)
  password: string;

  @ApiProperty()
  @IsString()
  fullName: string;

  @ApiProperty({ enum: STAFF_MANAGEABLE_ROLES })
  @IsIn(STAFF_MANAGEABLE_ROLES)
  role: (typeof STAFF_MANAGEABLE_ROLES)[number];
}
