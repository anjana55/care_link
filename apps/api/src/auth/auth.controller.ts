import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterCaregiverDto } from './dto/register-caregiver.dto';
import { RegisterPatientDto } from './dto/register-patient.dto';
import { VerifyEmailDto, ResendVerificationDto } from './dto/verify-email.dto';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
  ) {}

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    const tokens = await this.authService.login(dto.email, dto.password);
    await this.auditService.record({
      action: 'LOGIN',
      entityType: 'User',
      ipAddress: req.ip,
    });
    return tokens;
  }

  // Public signup endpoints are the most bot-targeted routes in the API,
  // so these get a much tighter limit than the global default on top of it.
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register-caregiver')
  async registerCaregiver(@Body() dto: RegisterCaregiverDto, @Req() req: Request) {
    const result = await this.authService.registerCaregiver(dto);
    await this.auditService.record({
      action: 'REGISTER_CAREGIVER',
      entityType: 'Caregiver',
      entityId: result.caregiverId,
      ipAddress: req.ip,
    });
    return result;
  }

  // Same rationale and rate limit as register-caregiver above.
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register-patient')
  async registerPatient(@Body() dto: RegisterPatientDto, @Req() req: Request) {
    const result = await this.authService.registerPatient(dto);
    await this.auditService.record({
      action: 'REGISTER_PATIENT',
      entityType: 'Patient',
      entityId: result.patientId,
      ipAddress: req.ip,
    });
    return result;
  }

  @Public()
  @Post('verify-email')
  async verifyEmail(@Body() dto: VerifyEmailDto) {
    return this.authService.verifyEmail(dto.token);
  }

  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('resend-verification')
  resendVerification(@Body() dto: ResendVerificationDto) {
    return this.authService.resendVerification(dto.email);
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  async logout(@CurrentUser() user: AuthenticatedUser) {
    await this.authService.logout(user.userId);
    await this.auditService.record({ userId: user.userId, action: 'LOGOUT', entityType: 'User', entityId: user.userId });
    return { success: true };
  }
}
