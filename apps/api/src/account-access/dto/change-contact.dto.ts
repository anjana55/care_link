import { ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsEmail, IsOptional, IsString, MaxLength, ValidateIf } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/**
 * Staff correcting how a caregiver is reached: the email address on their login
 * and the phone number on their record (and login). Each field is left alone
 * when omitted. Clearing is the reset's job, not this one's, so empty values
 * are refused.
 */
export class ChangeCaregiverContactDto {
  @ApiPropertyOptional({ example: 'nimali.perera@example.com', description: 'The new sign-in email address' })
  @IsOptional()
  @Transform(trim)
  @IsEmail({}, { message: 'Enter a valid email address' })
  @MaxLength(255)
  email?: string;

  @ApiPropertyOptional({ example: '0771234567', description: 'The new phone number - local or international format' })
  @IsOptional()
  @Transform(trim)
  @ValidateIf((o: ChangeCaregiverContactDto) => o.phone !== undefined)
  @IsString({ message: 'Enter a valid phone number' })
  @MaxLength(20, { message: 'Enter a valid phone number' })
  phone?: string;
}
