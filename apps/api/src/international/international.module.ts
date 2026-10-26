import { Module } from '@nestjs/common';
import { PublicSearchModule } from '../public-search/public-search.module';
import { EmailModule } from '../email/email.module';
import { EmployerEnquiriesService } from './employer-enquiries.service';
import { OverseasReadinessService } from './overseas-readiness.service';
import { SharedProfilesService } from './shared-profiles.service';
import { TrainingService } from './training.service';
import { InternationalNotifier } from './international-notifier.service';
import { EmployersService } from './employers.service';
import { CandidatesService } from './candidates.service';
import { ReadinessService } from './readiness.service';
import { EmployerController } from './employer.controller';
import {
  CaregiverInternationalController,
  PublicInternationalController,
  StaffInternationalController,
} from './international.controllers';

/**
 * Overseas employers looking for caregivers from Sri Lanka, and local
 * caregivers preparing for work abroad: enquiries, overseas readiness,
 * training and shareable profiles.
 */
@Module({
  imports: [PublicSearchModule, EmailModule],
  controllers: [PublicInternationalController, CaregiverInternationalController, StaffInternationalController, EmployerController],
  providers: [
    InternationalNotifier,
    EmployerEnquiriesService,
    OverseasReadinessService,
    SharedProfilesService,
    TrainingService,
    EmployersService,
    CandidatesService,
    ReadinessService,
  ],
})
export class InternationalModule {}
