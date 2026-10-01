import { Module } from '@nestjs/common';
import { PreferredLocationsService } from './preferred-locations.service';
import { PreferredLocationsController } from './preferred-locations.controller';

@Module({
  providers: [PreferredLocationsService],
  controllers: [PreferredLocationsController],
})
export class PreferredLocationsModule {}
