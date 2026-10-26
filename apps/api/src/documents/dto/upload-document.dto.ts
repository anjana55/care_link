import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsIn, IsOptional, Matches, ValidateIf } from 'class-validator';
import { documentTypeEnum } from '../../database/schema/documents.schema';

const blankToNull = ({ value }: { value: unknown }) => (typeof value === 'string' && value.trim() === '' ? null : value);

export class UploadDocumentDto {
  @ApiProperty({ enum: documentTypeEnum })
  @IsEnum(documentTypeEnum)
  documentType: (typeof documentTypeEnum)[number];

  /** When it stops being valid (a passport, a police clearance). Reminders go out before it. */
  @ApiPropertyOptional({ description: 'YYYY-MM-DD', nullable: true })
  @IsOptional()
  @Transform(blankToNull)
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString()
  expiresOn?: string | null;
}

export class DocumentVerificationDto {
  @ApiProperty({ enum: ['PENDING', 'IN_PROGRESS', 'VERIFIED', 'REJECTED'] })
  @IsIn(['PENDING', 'IN_PROGRESS', 'VERIFIED', 'REJECTED'])
  status: 'PENDING' | 'IN_PROGRESS' | 'VERIFIED' | 'REJECTED';

  /** Staff confirm or correct the expiry date as they check the document. Omit to leave it. */
  @ApiPropertyOptional({ description: 'YYYY-MM-DD', nullable: true })
  @IsOptional()
  @Transform(blankToNull)
  @ValidateIf((_, v) => v !== null)
  @Matches(/^\d{4}-\d{2}-\d{2}$/)
  @IsDateString()
  expiresOn?: string | null;
}
