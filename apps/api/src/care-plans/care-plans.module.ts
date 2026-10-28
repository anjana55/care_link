import { Module } from '@nestjs/common';
import { EmailModule } from '../email/email.module';
import { WhatsappModule } from '../whatsapp/whatsapp.module';
import { CarePlansService } from './care-plans.service';
import { CarePlanTemplatesService } from './care-plan-templates.service';
import { CarePlanSweepService } from './care-plan-sweep.service';
import { BookingCarePlanController, CarePlanTemplatesController, MyCareController } from './care-plans.controller';

/**
 * Care plans: the template library, each booking's plan, the client's daily
 * checklist, the caregiver's read-only view, and the midnight sweep.
 */
@Module({
  imports: [EmailModule, WhatsappModule],
  controllers: [CarePlanTemplatesController, BookingCarePlanController, MyCareController],
  providers: [CarePlansService, CarePlanTemplatesService, CarePlanSweepService],
  // Bookings marks which shifts a caregiver can open a plan for; insights counts critical misses.
  exports: [CarePlansService],
})
export class CarePlansModule {}
