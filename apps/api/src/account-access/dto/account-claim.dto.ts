import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length, MaxLength } from 'class-validator';

export class StartAccountClaimDto {
  @ApiProperty({ example: 'CG-2026-123456', description: 'The registration number shown when the form was submitted' })
  @IsString({ message: 'Registration number must be text' })
  @IsNotEmpty({ message: 'Enter your registration number' })
  // The column is varchar(32). Anything longer is not a registration number -
  // usually something pasted by mistake - so say that rather than "enter it".
  @MaxLength(32, { message: "That doesn't look like a registration number. It should look like CG-2026-123456." })
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
