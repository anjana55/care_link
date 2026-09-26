import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsInt, IsOptional, IsString } from 'class-validator';
import { proficiencyLevelEnum } from '../../database/schema/skills.schema';

export class AssignSkillDto {
  @ApiProperty()
  @IsString()
  skillId: string;

  @ApiPropertyOptional({ enum: proficiencyLevelEnum })
  @IsOptional()
  @IsEnum(proficiencyLevelEnum)
  proficiency?: (typeof proficiencyLevelEnum)[number];

  @ApiPropertyOptional()
  @IsOptional()
  @IsInt()
  yearsOfExperience?: number;
}
