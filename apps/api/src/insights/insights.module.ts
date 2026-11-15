import { Module } from '@nestjs/common';
import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';
import { CarePlansModule } from '../care-plans/care-plans.module';
import { BookingsModule } from '../bookings/bookings.module';

@Module({
  imports: [CarePlansModule, BookingsModule],
  controllers: [InsightsController],
  providers: [InsightsService],
})
export class InsightsModule {}
