import { ApiProperty } from '@nestjs/swagger';
import { IsString, Length } from 'class-validator';

export class StartAccountClaimDto {
  @ApiProperty({ example: 'CG-2026-123456', description: 'The registration number shown when the form was submitted' })
  @IsString({ message: 'Registration number must be text' })
  @Length(4, 40, { message: 'Enter your registration number' })
  registrationNumber: string;
}

export class VerifyAccountClaimDto extends StartAccountClaimDto {
  @ApiProperty({
    example: '482915',
    description: 'The code sent by WhatsApp or email, or the code a staff member gave you',
  })
  @IsString({ message: 'Code must be text' })
  @Length(4, 16, { message: 'Enter the code you received' })
  code: string;
}
