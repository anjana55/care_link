import { Body, Controller, Delete, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { IsIn, IsOptional, IsString, Matches, MaxLength } from 'class-validator';
import { Roles } from '../common/decorators/roles.decorator';
import { CurrentUser, type AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { deviceLocaleEnum, devicePlatformEnum, type DevicePlatform } from '../database/schema';
import { PushService, type PushLanguage } from './push.service';

export class RegisterDeviceDto {
  @ApiProperty({ example: 'ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]' })
  @IsString()
  @MaxLength(255)
  @Matches(/^Expo(nent)?PushToken\[[^\]]+\]$/)
  expoPushToken: string;

  @ApiProperty({ enum: devicePlatformEnum })
  @IsIn(devicePlatformEnum)
  platform: DevicePlatform;

  @ApiPropertyOptional({ example: '1.0.0' })
  @IsOptional()
  @IsString()
  @MaxLength(32)
  appVersion?: string;

  @ApiPropertyOptional({ enum: deviceLocaleEnum, description: "The app's language on this phone; pushes are written in it." })
  @IsOptional()
  @IsIn(deviceLocaleEnum)
  locale?: PushLanguage;
}

/** The signed-in caregiver's or client's phones, for push notifications from the mobile app. */
@ApiTags('push')
@ApiBearerAuth()
@Controller('me/devices')
export class DevicesController {
  constructor(private readonly push: PushService) {}

  /** Register this phone, or refresh it (the app calls this on every start and when the language changes). */
  @Post()
  @HttpCode(200)
  @Roles('CAREGIVER', 'PATIENT_GUARDIAN')
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  register(@CurrentUser() user: AuthenticatedUser, @Body() dto: RegisterDeviceDto) {
    return this.push.register(user.userId, dto);
  }

  /** Stop push to this phone. */
  @Delete(':id')
  @HttpCode(204)
  @Roles('CAREGIVER', 'PATIENT_GUARDIAN')
  async remove(@CurrentUser() user: AuthenticatedUser, @Param('id', ParseUUIDPipe) id: string) {
    await this.push.revoke(user.userId, id);
  }
}
