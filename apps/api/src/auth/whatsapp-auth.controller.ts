import { Body, Controller, Get, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { WhatsappAuthService } from './whatsapp-auth.service';
import {
  RegisterCaregiverWhatsappDto,
  RegisterPatientWhatsappDto,
  RequestWhatsappOtpDto,
  VerifyWhatsappOtpDto,
} from './dto/whatsapp-auth.dto';
import { Public } from '../common/decorators/public.decorator';
import { AuditService } from '../audit/audit.service';

/**
 * WhatsApp OTP sign-in, alongside (never instead of) the email/password
 * endpoints in AuthController. Logout, token refresh and password-free
 * session handling are the existing /auth/logout and /auth/refresh - a
 * WhatsApp session is the same JWT pair.
 */
@ApiTags('auth')
@Controller('auth/whatsapp')
export class WhatsappAuthController {
  constructor(
    private readonly whatsappAuth: WhatsappAuthService,
    private readonly auditService: AuditService,
  ) {}

  @Public()
  @Get('config')
  config() {
    return this.whatsappAuth.getPublicConfig();
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register-caregiver')
  async registerCaregiver(@Body() dto: RegisterCaregiverWhatsappDto, @Req() req: Request) {
    const { userId: _userId, ...result } = await this.whatsappAuth.registerCaregiver(dto);
    await this.auditService.record({
      action: 'REGISTER_CAREGIVER_WHATSAPP',
      entityType: 'Caregiver',
      entityId: result.caregiverId,
      ipAddress: req.ip,
    });
    return result;
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register-patient')
  async registerPatient(@Body() dto: RegisterPatientWhatsappDto, @Req() req: Request) {
    const { userId: _userId, ...result } = await this.whatsappAuth.registerPatient(dto);
    await this.auditService.record({
      action: 'REGISTER_PATIENT_WHATSAPP',
      entityType: 'Patient',
      entityId: result.patientId,
      ipAddress: req.ip,
    });
    return result;
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('request-otp')
  requestOtp(@Body() dto: RequestWhatsappOtpDto) {
    return this.whatsappAuth.requestOtp(dto);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('verify-otp')
  async verifyOtp(@Body() dto: VerifyWhatsappOtpDto, @Req() req: Request) {
    const { tokens, userId } = await this.whatsappAuth.verifyOtp(dto);
    const action = { REGISTER: 'VERIFY_PHONE_WHATSAPP', LOGIN: 'LOGIN_WHATSAPP', RECOVERY: 'RECOVER_ACCOUNT_WHATSAPP' }[dto.purpose];
    await this.auditService.record({ userId, action, entityType: 'User', entityId: userId, ipAddress: req.ip });
    return tokens;
  }
}
