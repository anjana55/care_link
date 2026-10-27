import { ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { IsIn, IsOptional } from 'class-validator';
import { CreateExperienceDto } from './create-experience.dto';

export const EXPERIENCE_VERIFICATION_STATUSES = ['PENDING', 'IN_PROGRESS', 'VERIFIED', 'REJECTED'] as const;

/** See UpdateQualificationDto: a real class so the whitelist applies. */
export class UpdateExperienceDto extends PartialType(CreateExperienceDto) {
  /** Admins only (the service ignores it from anyone else). */
  @ApiPropertyOptional({ enum: EXPERIENCE_VERIFICATION_STATUSES })
  @IsOptional()
  @IsIn(EXPERIENCE_VERIFICATION_STATUSES)
  verificationStatus?: (typeof EXPERIENCE_VERIFICATION_STATUSES)[number];
}
