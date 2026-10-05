import { ApiProperty } from '@nestjs/swagger';
import { IsString, MinLength } from 'class-validator';

export class ExchangeSocialCodeDto {
  @ApiProperty({
    description: 'The one-time code the sign-in callback redirected with',
    example: 'a3f1c9e2b7d04a6f8e1c5b2d9a7f0e34c6b8d1a5f9e2c7b0d4a6f8e1c5b2d9a7f',
  })
  @IsString({ message: 'Sign-in code must be text' })
  // 32 hex bytes. Short enough to be a friendlier message than the generic 400,
  // long enough that a truncated or mistyped code never reaches the database.
  @MinLength(32, { message: 'Sign-in code is not valid' })
  code: string;
}