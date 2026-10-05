import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { AuditModule } from '../audit/audit.module';
import { EmailModule } from '../email/email.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { WhatsappAuthService } from './whatsapp-auth.service';
import { WhatsappAuthController } from './whatsapp-auth.controller';
import { SocialAuthService } from './social-auth.service';
import { SocialAuthController } from './social-auth.controller';
import {
  FacebookProviderClient,
  GoogleProviderClient,
  MicrosoftProviderClient,
  SocialProviderRegistry,
} from './social/social-provider';

@Module({
  imports: [
    PassportModule,
    AuditModule,
    EmailModule,
    WhatsappModule,
    JwtModule.registerAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        secret: config.get<string>('JWT_ACCESS_SECRET'),
        // @nestjs/jwt's expiresIn type is now a branded string template
        // (e.g. "15m") rather than plain `string`; the value genuinely comes
        // from .env at runtime, so it can't be statically narrowed further.
        signOptions: { expiresIn: (config.get<string>('JWT_ACCESS_EXPIRES_IN') ?? '15m') as any },
      }),
    }),
  ],
  providers: [
    AuthService,
    WhatsappAuthService,
    SocialAuthService,
    JwtStrategy,
    // Registry only - the three clients are constructed with the ConfigService
    // and are not useful to anything outside this file.
    GoogleProviderClient,
    MicrosoftProviderClient,
    FacebookProviderClient,
    SocialProviderRegistry,
  ],
  controllers: [AuthController, WhatsappAuthController, SocialAuthController],
  exports: [AuthService],
})
export class AuthModule {}
