import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsString, MinLength } from 'class-validator';

export class LoginDto {
  // Examples are placeholders, not seeded credentials. Swagger UI is served
  // by the API itself, so a real address and a real password here would be a
  // working admin login published to anyone who can reach the docs.
  @ApiProperty({ example: 'you@example.com' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'your-password' })
  @IsString()
  @MinLength(8)
  password: string;
}
