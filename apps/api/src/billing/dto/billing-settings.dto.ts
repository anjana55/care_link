import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsEmail, IsIn, IsInt, IsOptional, IsString, Matches, Max, MaxLength, Min, ValidateIf } from 'class-validator';
import { payhereModeEnum } from '../../database/schema';

/**
 * Partial update - the admin form sends back what it has. An empty string for
 * an optional text field means "clear it". Whether the resulting setup is
 * complete (PayHere switched on needs a merchant and secret) is checked in the
 * service, where the stored values are known.
 */
export class UpdateBillingSettingsDto {
  @ApiPropertyOptional({ example: 'CareLink (Pvt) Ltd' })
  @IsOptional() @IsString() @MaxLength(200)
  businessName?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(500)
  businessAddress?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(40)
  businessPhone?: string;

  @ApiPropertyOptional()
  @IsOptional() @ValidateIf((_, v) => v !== '') @IsEmail({}, { message: 'Enter a valid email address for invoices' }) @MaxLength(255)
  businessEmail?: string;

  @ApiPropertyOptional({ description: 'Business registration number (e.g. PV 12345)' })
  @IsOptional() @IsString() @MaxLength(60)
  registrationNumber?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  taxEnabled?: boolean;

  @ApiPropertyOptional({ example: 'VAT' })
  @IsOptional() @IsString() @MaxLength(40)
  taxName?: string;

  @ApiPropertyOptional({ example: '18.00' })
  @IsOptional()
  @Matches(/^\d{1,2}(\.\d{1,2})?$|^100(\.0{1,2})?$/, { message: 'Enter the tax rate as a percentage, e.g. 18' })
  taxRate?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(60)
  taxRegistrationNumber?: string;

  @ApiPropertyOptional({ example: 'INV' })
  @IsOptional()
  @Matches(/^[A-Z0-9]{1,8}$/, { message: 'The invoice prefix is 1-8 capital letters or digits' })
  invoicePrefix?: string;

  @ApiPropertyOptional({ description: 'The number the next issued invoice takes. Can only move forward.' })
  @IsOptional() @IsInt() @Min(1) @Max(99_999_999)
  nextInvoiceNumber?: number;

  @ApiPropertyOptional({ example: 7 })
  @IsOptional() @IsInt() @Min(0) @Max(120)
  paymentTermsDays?: number;

  @ApiPropertyOptional({ description: 'Printed at the foot of every invoice, e.g. bank details' })
  @IsOptional() @IsString() @MaxLength(2000)
  invoiceFooter?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsBoolean()
  payhereEnabled?: boolean;

  @ApiPropertyOptional({ enum: payhereModeEnum })
  @IsOptional() @IsIn(payhereModeEnum)
  payhereMode?: (typeof payhereModeEnum)[number];

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(40)
  @Matches(/^$|^\d{4,40}$/, { message: 'The PayHere merchant ID is a number' })
  payhereMerchantId?: string;

  @ApiPropertyOptional({ description: 'Write-only. Omit to keep the stored secret.' })
  @IsOptional() @IsString() @MaxLength(255)
  payhereMerchantSecret?: string;

  @ApiPropertyOptional({ description: 'Remove the stored merchant secret' })
  @IsOptional() @IsBoolean()
  clearPayhereMerchantSecret?: boolean;

  @ApiPropertyOptional({ example: 'https://find.caregivers.lk/api', description: 'Empty = PUBLIC_WEB_URL + /api' })
  @IsOptional() @IsString() @MaxLength(255)
  @Matches(/^$|^https?:\/\/[^\s]+$/, { message: 'Enter the API address starting with https://' })
  payhereNotifyBaseUrl?: string;
}
