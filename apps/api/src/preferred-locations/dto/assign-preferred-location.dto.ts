import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class AssignPreferredLocationDto {
  @ApiProperty()
  @IsString()
  locationId: string;
}
