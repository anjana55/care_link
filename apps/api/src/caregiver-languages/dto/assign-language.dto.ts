import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEnum, IsOptional, IsString } from 'class-validator';
import { languageProficiencyEnum } from '../../database/schema/languages.schema';

export class AssignLanguageDto {
  @ApiProperty()
  @IsString()
  languageId: string;

  @ApiPropertyOptional({ enum: languageProficiencyEnum })
  @IsOptional()
  @IsEnum(languageProficiencyEnum)
  proficiency?: (typeof languageProficiencyEnum)[number];
}
