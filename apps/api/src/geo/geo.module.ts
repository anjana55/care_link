import { Module } from '@nestjs/common';
import { GeoService } from './geo.service';
import { ClientGeoController, PublicGeoController } from './geo.controller';

@Module({
  controllers: [PublicGeoController, ClientGeoController],
  providers: [GeoService],
  exports: [GeoService],
})
export class GeoModule {}
