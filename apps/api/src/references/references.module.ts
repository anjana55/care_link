import { Module } from '@nestjs/common';
import { ReferencesService } from './references.service';
import { ReferencesController } from './references.controller';

@Module({
  providers: [ReferencesService],
  controllers: [ReferencesController],
})
export class ReferencesModule {}
