import { ApiProperty } from '@nestjs/swagger';
import { IsEnum } from 'class-validator';
import { clientStatusEnum } from '../../database/schema/patients.schema';

/** Unlike the caregiver DTO there is no optional notes field: a client
 * status change carries no reviewer note, and an accepted-but-ignored
 * notes field would be worse than none. */
export class UpdateStatusDto {
  @ApiProperty({ enum: clientStatusEnum })
  @IsEnum(clientStatusEnum)
  status: (typeof clientStatusEnum)[number];
}