import { Module } from '@nestjs/common';
import { PublicSearchModule } from '../public-search/public-search.module';
import { EmailModule } from '../email/email.module';
import { EmployerEnquiriesService } from './employer-enquiries.service';
import { OverseasReadinessService } from './overseas-readiness.service';
import { SharedProfilesService } from './shared-profiles.service';
import { TrainingService } from './training.service';
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
  controllers: [PublicInternationalController, CaregiverInternationalController, StaffInternationalController],
  providers: [EmployerEnquiriesService, OverseasReadinessService, SharedProfilesService, TrainingService],
})
export class InternationalModule {}
