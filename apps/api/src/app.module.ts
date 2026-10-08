import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { validateEnv } from './common/env.validation';
import { DatabaseModule } from './database/database.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { RolesGuard } from './common/guards/roles.guard';
import { CaregiverScopeGuard } from './common/guards/caregiver-scope.guard';
import { AuditInterceptor } from './common/interceptors/audit.interceptor';
import { LocalizeResponseInterceptor } from './common/interceptors/localize-response.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { LanguageMiddleware } from './common/i18n/language.middleware';

import { AuthModule } from './auth/auth.module';
import { UsersModule } from './users/users.module';
import { AuditModule } from './audit/audit.module';
import { StorageModule } from './storage/storage.module';
import { SkillsModule } from './skills/skills.module';
import { LanguagesModule } from './languages/languages.module';
import { LocationsModule } from './locations/locations.module';
import { CaregiversModule } from './caregivers/caregivers.module';
import { PatientsModule } from './patients/patients.module';
import { QualificationsModule } from './qualifications/qualifications.module';
import { ExperiencesModule } from './experiences/experiences.module';
import { AvailabilityModule } from './availability/availability.module';
import { CaregiverSkillsModule } from './caregiver-skills/caregiver-skills.module';
import { CaregiverLanguagesModule } from './caregiver-languages/caregiver-languages.module';
import { PreferredLocationsModule } from './preferred-locations/preferred-locations.module';
import { ReferencesModule } from './references/references.module';
import { DocumentsModule } from './documents/documents.module';
import { HealthInformationModule } from './health-information/health-information.module';
import { VerificationModule } from './verification/verification.module';
import { PublicSearchModule } from './public-search/public-search.module';
import { WhatsappModule } from './whatsapp/whatsapp.module';
import { AccountAccessModule } from './account-access/account-access.module';

@Module({
  imports: [
    // Same lookup order as the db:* scripts (src/database/load-env.ts): apps/api/.env,
    // then a repo-root .env. Real environment variables (Docker, pm2) always win,
    // and missing files are simply skipped.
    ConfigModule.forRoot({ isGlobal: true, validate: validateEnv, envFilePath: ['.env', '../../.env'] }),
    ThrottlerModule.forRoot({
      throttlers: [
        {
          ttl: Number(process.env.THROTTLE_TTL ?? 60) * 1000,
          limit: Number(process.env.THROTTLE_LIMIT ?? 100),
        },
      ],
    }),
    DatabaseModule,
    AuditModule,
    StorageModule,
    AuthModule,
    UsersModule,
    SkillsModule,
    LanguagesModule,
    LocationsModule,
    CaregiversModule,
    PatientsModule,
    QualificationsModule,
    ExperiencesModule,
    AvailabilityModule,
    CaregiverSkillsModule,
    CaregiverLanguagesModule,
    PreferredLocationsModule,
    ReferencesModule,
    DocumentsModule,
    HealthInformationModule,
    VerificationModule,
    PublicSearchModule,
    WhatsappModule,
    AccountAccessModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_GUARD, useClass: CaregiverScopeGuard },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_INTERCEPTOR, useClass: LocalizeResponseInterceptor },
    // Registered here rather than in main.ts so the end-to-end tests, which build
    // the app from this module, exercise the same error shape and translation.
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // Every route: the language is needed by errors from guards, pipes and
    // services alike, which all run after this.
    consumer.apply(LanguageMiddleware).forRoutes('*');
  }
}
