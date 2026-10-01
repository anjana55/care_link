import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { documentTypeEnum } from '../../database/schema/documents.schema';

export class UploadDocumentDto {
  @ApiProperty({ enum: documentTypeEnum })
  @IsEnum(documentTypeEnum)
  documentType: (typeof documentTypeEnum)[number];
}
