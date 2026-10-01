import { Module } from '@nestjs/common';
import { CaregiverSkillsService } from './caregiver-skills.service';
import { CaregiverSkillsController } from './caregiver-skills.controller';

@Module({
  providers: [CaregiverSkillsService],
  controllers: [CaregiverSkillsController],
})
export class CaregiverSkillsModule {}
