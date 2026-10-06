import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { LOGIN_PORTALS, type LoginPortal } from '../../common/auth/login-portal';

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

  @ApiPropertyOptional({
    enum: LOGIN_PORTALS,
    description:
      'Which sign-in screen this is. Credentials for an account that belongs to a different portal are refused with the same "Invalid credentials" as a wrong password. ' +
      'Omit only for older clients; the server can be set to require it (AUTH_REQUIRE_LOGIN_PORTAL).',
  })
  @IsOptional()
  @IsIn(LOGIN_PORTALS)
  portal?: LoginPortal;
}
