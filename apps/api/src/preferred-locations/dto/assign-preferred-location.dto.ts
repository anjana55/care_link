import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Min } from 'class-validator';

export class AssignPreferredLocationDto {
  /** A city id from the locations reference data, not a free-text name. */
  @ApiProperty()
  @IsInt()
  @Min(1)
  cityId: number;
}
