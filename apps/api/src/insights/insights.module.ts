import { Module } from '@nestjs/common';
import { InsightsController } from './insights.controller';
import { InsightsService } from './insights.service';
import { CarePlansModule } from '../care-plans/care-plans.module';

@Module({
  imports: [CarePlansModule],
  controllers: [InsightsController],
  providers: [InsightsService],
})
export class InsightsModule {}
