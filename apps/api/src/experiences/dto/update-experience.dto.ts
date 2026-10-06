import { PartialType } from '@nestjs/swagger';
import { CreateExperienceDto } from './create-experience.dto';

/** See UpdateQualificationDto: a real class so the whitelist applies. */
export class UpdateExperienceDto extends PartialType(CreateExperienceDto) {}
