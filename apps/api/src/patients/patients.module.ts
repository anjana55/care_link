import { Module } from '@nestjs/common';
import { PatientsService } from './patients.service';
import { PatientsController } from './patients.controller';
import { WhatsappModule } from '../whatsapp/whatsapp.module';

@Module({
  // WhatsappModule is a leaf with no imports of its own, and AuthModule
  // already pulls it in, so this is not a cycle. Imported for
  // WhatsappSettingsService, which supplies the country code that turns a
  // locally-typed phone into E.164.
  imports: [WhatsappModule],
  providers: [PatientsService],
  controllers: [PatientsController],
  exports: [PatientsService],
})
export class PatientsModule {}