import { Module } from '@nestjs/common';
import { PublicSearchModule } from '../public-search/public-search.module';
import { EmailModule } from '../email/email.module';
import { BillingModule } from '../billing/billing.module';
import { EmployerEnquiriesService } from './employer-enquiries.service';
import { OverseasReadinessService } from './overseas-readiness.service';
import { SharedProfilesService } from './shared-profiles.service';
import { TrainingService } from './training.service';
import { InternationalNotifier } from './international-notifier.service';
import { EmployersService } from './employers.service';
import { CandidatesService } from './candidates.service';
import { ReadinessService } from './readiness.service';
import { EmployerController } from './employer.controller';
import { VacanciesService } from './vacancies.service';
import { PlacementsService } from './placements.service';
import { PlacementInvoicesService } from './placement-invoices.service';
import { DocumentExpiryService } from './document-expiry.service';
import {
  CaregiverOverseasController,
  EmployerPhase3Controller,
  PlacementPayhereNotifyController,
  PublicVacanciesController,
  StaffOverseasPhase3Controller,
} from './phase3.controllers';
import {
  CaregiverInternationalController,
  PublicInternationalController,
  StaffInternationalController,
} from './international.controllers';

/**
 * Overseas employers looking for caregivers from Sri Lanka, and local
 * caregivers preparing for work abroad: enquiries, overseas readiness,
 * training and shareable profiles; the vacancy board, placements with their
 * welfare check-ins, placement-fee invoices, and document expiry reminders.
 */
@Module({
  imports: [PublicSearchModule, EmailModule, BillingModule],
  controllers: [
    PublicInternationalController,
    CaregiverInternationalController,
    StaffInternationalController,
    EmployerController,
    PublicVacanciesController,
    CaregiverOverseasController,
    EmployerPhase3Controller,
    StaffOverseasPhase3Controller,
    PlacementPayhereNotifyController,
  ],
  providers: [
    InternationalNotifier,
    EmployerEnquiriesService,
    OverseasReadinessService,
    SharedProfilesService,
    TrainingService,
    EmployersService,
    CandidatesService,
    ReadinessService,
    VacanciesService,
    PlacementsService,
    PlacementInvoicesService,
    DocumentExpiryService,
  ],
})
export class InternationalModule {}
