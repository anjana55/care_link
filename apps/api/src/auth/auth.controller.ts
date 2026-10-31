import { Body, Controller, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { AuthService } from './auth.service';
import { LoginDto } from './dto/login.dto';
import { WrongPortalException } from '../common/auth/login-portal';
import { PushService } from '../push/push.service';
import { RefreshTokenDto } from './dto/refresh-token.dto';
import { RegisterCaregiverDto } from './dto/register-caregiver.dto';
import { RegisterPatientDto } from './dto/register-patient.dto';
import { RegisterEmployerDto } from './dto/register-employer.dto';
import { VerifyEmailDto, ResendVerificationDto } from './dto/verify-email.dto';
import { ChangePasswordDto } from './dto/change-password.dto';
import { ForgotPasswordDto, ResetPasswordWithTokenDto, ResetTokenDto } from './dto/password-reset.dto';
import { PasswordResetService } from './password-reset.service';
import { Public } from '../common/decorators/public.decorator';
import { CurrentUser, AuthenticatedUser } from '../common/decorators/current-user.decorator';
import { AuditService } from '../audit/audit.service';

@ApiTags('auth')
@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
    private readonly auditService: AuditService,
    private readonly passwordReset: PasswordResetService,
    private readonly push: PushService,
  ) {}

  @Public()
  @Post('login')
  async login(@Body() dto: LoginDto, @Req() req: Request) {
    let tokens;
    try {
      tokens = await this.authService.login(dto.email, dto.password, dto.portal);
    } catch (err) {
      // The caller sees an ordinary failed sign-in; the audit log shows staff
      // that real credentials were used on the wrong portal.
      if (err instanceof WrongPortalException) {
        await this.auditService.record({
          userId: err.userId,
          action: 'LOGIN_WRONG_PORTAL',
          entityType: 'User',
          entityId: err.userId,
          ipAddress: req.ip,
        });
      }
      throw err;
    }
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

  // An overseas employer's account. Same rate limit as the other sign-ups.
  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('register-employer')
  async registerEmployer(@Body() dto: RegisterEmployerDto, @Req() req: Request) {
    const result = await this.authService.registerEmployer(dto);
    await this.auditService.record({
      action: 'REGISTER_EMPLOYER',
      entityType: 'Employer',
      entityId: result.employerId,
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

  // "Forgot password?" on the public site. Same answer whether or not the
  // address has an account; tightly throttled because it sends email.
  @Public()
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  @Post('forgot-password')
  forgotPassword(@Body() dto: ForgotPasswordDto) {
    return this.passwordReset.requestReset(dto.email);
  }

  @Public()
  @Throttle({ default: { limit: 20, ttl: 60_000 } })
  @Post('reset-password/check')
  checkResetLink(@Body() dto: ResetTokenDto) {
    return this.passwordReset.checkToken(dto.token);
  }

  @Public()
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  @Post('reset-password')
  async resetPassword(@Body() dto: ResetPasswordWithTokenDto, @Req() req: Request) {
    const { userId, role } = await this.passwordReset.resetWithToken(dto.token, dto.newPassword);
    await this.auditService.record({ userId, action: 'RESET_PASSWORD_BY_LINK', entityType: 'User', entityId: userId, ipAddress: req.ip });
    // The role, so the page can point at the right sign-in; never a session -
    // the person signs in with the new password like any other time.
    return { success: true, role };
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshTokenDto) {
    return this.authService.refresh(dto.refreshToken);
  }

  @Post('logout')
  async logout(@CurrentUser() user: AuthenticatedUser) {
    await this.authService.logout(user.userId);
    // Sign-out ends every session, so no phone keeps getting this person's
    // alerts - on a shared phone, the next person signs in and registers it again.
    await this.push.revokeAllForUser(user.userId);
    await this.auditService.record({ userId: user.userId, action: 'LOGOUT', entityType: 'User', entityId: user.userId });
    return { success: true };
  }

  // Self-service, available to every authenticated role (no @Roles here) -
  // deliberately separate from the ADMIN-only /users/:id/reset-password.
  @Post('change-password')
  async changePassword(@Body() dto: ChangePasswordDto, @CurrentUser() user: AuthenticatedUser) {
    await this.authService.changePassword(user.userId, dto.currentPassword, dto.newPassword);
    await this.auditService.record({ userId: user.userId, action: 'CHANGE_PASSWORD', entityType: 'User', entityId: user.userId });
    return { success: true };
  }
}
