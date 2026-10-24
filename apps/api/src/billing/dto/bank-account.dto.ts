import { ApiProperty, ApiPropertyOptional, PartialType } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import { IsBoolean, IsOptional, IsString, Matches, MaxLength, MinLength } from 'class-validator';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

/** One of the business's own bank accounts (Settings > Billing). */
export class CreateBankAccountDto {
  @ApiProperty({ example: 'Commercial Bank' })
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Enter the bank name' })
  @MaxLength(120)
  bankName: string;

  @ApiPropertyOptional({ example: 'Maharagama' })
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(120)
  branch?: string;

  @ApiProperty({ example: 'CareLink (Pvt) Ltd' })
  @Transform(trim)
  @IsString()
  @MinLength(1, { message: 'Enter the account name' })
  @MaxLength(200)
  accountName: string;

  @ApiProperty({ example: '1000123456' })
  @Transform(trim)
  @IsString()
  @Matches(/^[0-9A-Za-z -]{3,40}$/, { message: 'Enter the account number (letters, digits, spaces or dashes)' })
  accountNumber: string;

  @ApiPropertyOptional({ default: true, description: 'Turned-off accounts cannot be picked for new payments' })
  @IsOptional()
  @IsBoolean()
  active?: boolean;
}

export class UpdateBankAccountDto extends PartialType(CreateBankAccountDto) {}
