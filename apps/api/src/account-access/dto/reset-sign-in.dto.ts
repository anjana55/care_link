import { ApiPropertyOptional } from '@nestjs/swagger';
import { ArrayUnique, IsArray, IsBoolean, IsIn, IsOptional } from 'class-validator';
import { socialProviderEnum, type SocialProvider } from '../../database/schema';

/**
 * Which sign-in methods a staff reset removes. Every reset also revokes all
 * sessions and voids outstanding sign-in links and codes, whatever is chosen.
 */
export class ResetSignInDto {
  @ApiPropertyOptional({ enum: socialProviderEnum, isArray: true, description: 'Provider links to remove' })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsIn(socialProviderEnum, { each: true, message: 'Unknown sign-in provider' })
  providers?: SocialProvider[];

  @ApiPropertyOptional({ description: 'Remove the password (email + password sign-in)' })
  @IsOptional()
  @IsBoolean()
  password?: boolean;

  @ApiPropertyOptional({
    description:
      'Release the sign-in phone number: WhatsApp sign-in stops, and the number is re-verified the next time the caregiver finishes their account',
  })
  @IsOptional()
  @IsBoolean()
  phone?: boolean;

  @ApiPropertyOptional({
    description:
      'Clear the email address on the login. Needed when the caregiver will link a Google/Microsoft/Facebook account that uses a different address',
  })
  @IsOptional()
  @IsBoolean()
  email?: boolean;
}
