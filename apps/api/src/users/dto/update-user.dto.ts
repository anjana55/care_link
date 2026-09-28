import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsIn, IsOptional, IsString, MinLength } from 'class-validator';
import { STAFF_MANAGEABLE_ROLES } from './create-user.dto';

export class UpdateUserDto {
  @ApiPropertyOptional()
  @IsOptional()
  @IsEmail()
  email?: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  @MinLength(1)
  fullName?: string;

  @ApiPropertyOptional({ enum: STAFF_MANAGEABLE_ROLES })
  @IsOptional()
  @IsIn(STAFF_MANAGEABLE_ROLES)
  role?: (typeof STAFF_MANAGEABLE_ROLES)[number];
}
