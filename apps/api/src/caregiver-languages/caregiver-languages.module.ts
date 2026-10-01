import { Module } from '@nestjs/common';
import { CaregiverLanguagesService } from './caregiver-languages.service';
import { CaregiverLanguagesController } from './caregiver-languages.controller';

@Module({
  providers: [CaregiverLanguagesService],
  controllers: [CaregiverLanguagesController],
})
export class CaregiverLanguagesModule {}
