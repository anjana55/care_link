import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsEmail,
  IsEnum,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  Max,
  MaxLength,
  Min,
  ValidateIf,
  ValidateNested,
} from 'class-validator';
import { MAX_BILLING_LINES } from '@care-platform/shared';
import {
  billingLineKindEnum,
  billingUnitEnum,
  careRequestLanguageEnum,
  discountTypeEnum,
  invoiceBasisEnum,
  invoiceStatusEnum,
  payoutStatusEnum,
  type CareRequestLanguage,
} from '../../database/schema';

const DATE = /^\d{4}-\d{2}-\d{2}$/;
/** A non-negative amount, two places at most. */
const AMOUNT = /^\d{1,10}(\.\d{1,2})?$/;
/** An amount that may be negative (a credit). */
const SIGNED = /^-?\d{1,10}(\.\d{1,2})?$/;
const QUANTITY = /^\d{1,6}(\.\d{1,2})?$/;
const trimToUndefined = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() || undefined : value);

const MANUAL_METHODS = ['CASH', 'BANK_TRANSFER', 'CHEQUE', 'CARD', 'OTHER'] as const;
type ManualMethod = (typeof MANUAL_METHODS)[number];
const PAYMENT_TYPES = ['CASH', 'BANK', 'ONLINE'] as const;
type PaymentTypeValue = (typeof PAYMENT_TYPES)[number];

// --- lines (invoices and payouts) ----------------------------------------------

export class BillingLineDto {
  @ApiPropertyOptional({ description: 'An existing line keeps its link to the shift it bills; omit for a new line' })
  @IsOptional()
  @IsUUID('all', { message: 'This line is not part of the document' })
  id?: string;

  @ApiProperty({ enum: billingLineKindEnum, description: 'New lines are ITEM or ADJUSTMENT; SHIFT lines come from shifts' })
  @IsEnum(billingLineKindEnum, { message: 'Choose what kind of line this is' })
  kind: (typeof billingLineKindEnum)[number];

  @ApiProperty({ example: 'Transport allowance' })
  @Transform(trimToUndefined)
  @IsString({ message: 'Describe every line' })
  @MaxLength(300, { message: 'Keep each line description to 300 characters or fewer' })
  description: string;

  @ApiPropertyOptional({ example: '2026-10-20' })
  @IsOptional()
  @Matches(DATE, { message: 'Enter the date as YYYY-MM-DD' })
  serviceDate?: string | null;

  @ApiProperty({ example: '1.00' })
  @Matches(QUANTITY, { message: 'Enter the quantity as a number' })
  quantity: string;

  @ApiProperty({ enum: billingUnitEnum })
  @IsEnum(billingUnitEnum, { message: 'Choose a unit' })
  unit: (typeof billingUnitEnum)[number];

  @ApiProperty({ example: '3500.00', description: 'Negative only on an ADJUSTMENT (a credit or deduction)' })
  @Matches(SIGNED, { message: 'Enter the price as a number' })
  unitPrice: string;

  @ApiPropertyOptional({ enum: discountTypeEnum, nullable: true })
  @IsOptional()
  @IsEnum(discountTypeEnum, { message: 'Choose a percentage or an amount' })
  discountType?: (typeof discountTypeEnum)[number] | null;

  @ApiPropertyOptional({ example: '10', nullable: true })
  @IsOptional()
  @ValidateIf((o: BillingLineDto) => Boolean(o.discountType))
  @Matches(AMOUNT, { message: 'Enter the discount as a number' })
  discountValue?: string | null;

  @ApiPropertyOptional({ description: 'Invoices only: false leaves the line out of tax (e.g. a reimbursed expense)' })
  @IsOptional()
  @IsBoolean()
  taxable?: boolean;
}

export class ReplaceLinesDto {
  @ApiProperty({ type: [BillingLineDto] })
  @IsArray()
  @ArrayMaxSize(MAX_BILLING_LINES, { message: 'A document can have at most 500 lines' })
  @ValidateNested({ each: true })
  @Type(() => BillingLineDto)
  lines: BillingLineDto[];
}

// --- invoices ------------------------------------------------------------------

export class CreateInvoiceDto {
  @ApiPropertyOptional({ description: 'Bill one booking. Its client is the one billed.' })
  @IsOptional()
  @IsUUID('all', { message: 'Choose a valid booking' })
  bookingId?: string;

  @ApiPropertyOptional({ description: "Required unless bookingId is given: bills all of this client's bookings" })
  @ValidateIf((o: CreateInvoiceDto) => !o.bookingId)
  @IsUUID('all', { message: 'Choose the client' })
  patientId?: string;

  @ApiProperty({ enum: invoiceBasisEnum, description: 'COMPLETED: shifts done; SCHEDULED: billed in advance; MANUAL: start empty' })
  @IsEnum(invoiceBasisEnum, { message: 'Choose what to bill' })
  basis: (typeof invoiceBasisEnum)[number];

  @ApiPropertyOptional({ example: '2026-10-01' })
  @ValidateIf((o: CreateInvoiceDto) => o.basis !== 'MANUAL' || o.periodStart !== undefined)
  @Matches(DATE, { message: 'Enter the first day of the period' })
  periodStart?: string;

  @ApiPropertyOptional({ example: '2026-10-31' })
  @ValidateIf((o: CreateInvoiceDto) => o.basis !== 'MANUAL' || o.periodEnd !== undefined)
  @Matches(DATE, { message: 'Enter the last day of the period' })
  periodEnd?: string;

  @ApiPropertyOptional({ enum: careRequestLanguageEnum, description: "Defaults to the booking's language, else English" })
  @IsOptional()
  @IsIn(careRequestLanguageEnum, { message: 'Choose the language for the invoice' })
  language?: CareRequestLanguage;
}

/** PATCH /invoices/:id - DRAFT only. */
export class UpdateInvoiceDto {
  @ApiPropertyOptional()
  @IsOptional()
  @Transform(trimToUndefined)
  @IsString({ message: 'Enter who the invoice is addressed to' })
  @MaxLength(200)
  billToName?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(500)
  billToAddress?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(40)
  billToPhone?: string;

  @ApiPropertyOptional()
  @IsOptional() @ValidateIf((_, v) => v !== '') @IsEmail({}, { message: 'Enter a valid email address' }) @MaxLength(255)
  billToEmail?: string;

  @ApiPropertyOptional()
  @IsOptional() @Matches(DATE, { message: 'Enter the first day of the period' })
  periodStart?: string;

  @ApiPropertyOptional()
  @IsOptional() @Matches(DATE, { message: 'Enter the last day of the period' })
  periodEnd?: string;

  @ApiPropertyOptional({ enum: discountTypeEnum, nullable: true })
  @IsOptional()
  @IsEnum(discountTypeEnum, { message: 'Choose a percentage or an amount' })
  discountType?: (typeof discountTypeEnum)[number] | null;

  @ApiPropertyOptional({ nullable: true })
  @IsOptional()
  @Matches(AMOUNT, { message: 'Enter the discount as a number' })
  discountValue?: string | null;

  @ApiPropertyOptional({ nullable: true, example: 'Loyalty discount' })
  @IsOptional() @IsString() @MaxLength(200)
  discountReason?: string | null;

  @ApiPropertyOptional({ description: 'Charge tax at the rate in billing settings' })
  @IsOptional() @IsBoolean()
  applyTax?: boolean;

  @ApiPropertyOptional({ description: 'Printed on the invoice' })
  @IsOptional() @IsString() @MaxLength(2000, { message: 'Notes must be 2000 characters or fewer' })
  notes?: string;

  @ApiPropertyOptional({ enum: careRequestLanguageEnum })
  @IsOptional() @IsIn(careRequestLanguageEnum, { message: 'Choose the language for the invoice' })
  language?: CareRequestLanguage;
}

export class IssueInvoiceDto {
  @ApiPropertyOptional({ example: '2026-10-31', description: 'Defaults to today (Colombo)' })
  @IsOptional() @Matches(DATE, { message: 'Enter the issue date' })
  issueDate?: string;

  @ApiPropertyOptional({ example: '2026-11-07', description: 'Defaults to the issue date plus the payment terms' })
  @IsOptional() @Matches(DATE, { message: 'Enter the due date' })
  dueDate?: string;

  @ApiPropertyOptional({ default: true, description: 'Tell the client by email or WhatsApp' })
  @IsOptional() @IsBoolean()
  notify?: boolean;
}

export class ReasonDto {
  @ApiProperty()
  @Transform(trimToUndefined)
  @IsString({ message: 'Give a reason' })
  @MaxLength(500)
  reason: string;
}

export class RecordPaymentDto {
  @ApiPropertyOptional({ enum: ['PAYMENT', 'REFUND'], default: 'PAYMENT' })
  @IsOptional() @IsIn(['PAYMENT', 'REFUND'])
  kind?: 'PAYMENT' | 'REFUND';

  @ApiProperty({ example: '15000.00' })
  @Matches(AMOUNT, { message: 'Enter the amount as a number' })
  amount: string;

  @ApiProperty({ enum: PAYMENT_TYPES, description: 'Cash, bank or online' })
  @IsIn(PAYMENT_TYPES, { message: 'Choose how it was paid' })
  paymentType: PaymentTypeValue;

  @ApiPropertyOptional({ enum: MANUAL_METHODS, description: 'Optional detail under the type, e.g. CHEQUE for a bank payment' })
  @IsOptional()
  @Transform(trimToUndefined)
  @IsIn(MANUAL_METHODS, { message: 'Choose a valid payment detail' })
  method?: ManualMethod;

  @ApiPropertyOptional({ description: 'Bank payments only: which of the business bank accounts (Settings > Billing)' })
  @IsOptional()
  @Transform(trimToUndefined)
  @IsUUID('all', { message: 'Choose a bank account' })
  bankAccountId?: string;

  @ApiProperty({ example: '2026-10-31' })
  @Matches(DATE, { message: 'Enter the date it was paid' })
  paidOn: string;

  @ApiPropertyOptional({ example: 'Slip 4471' })
  @IsOptional() @Transform(trimToUndefined) @IsString() @MaxLength(120)
  reference?: string;

  @ApiPropertyOptional()
  @IsOptional() @Transform(trimToUndefined) @IsString() @MaxLength(500)
  note?: string;

  @ApiPropertyOptional({ default: true, description: 'Tell the client when this settles the invoice' })
  @IsOptional() @IsBoolean()
  notify?: boolean;
}

export class InvoiceQueryDto {
  @ApiPropertyOptional({ enum: invoiceStatusEnum })
  @IsOptional() @IsEnum(invoiceStatusEnum)
  status?: (typeof invoiceStatusEnum)[number];

  @ApiPropertyOptional({ description: 'Only issued invoices past their due date' })
  @IsOptional()
  @Transform(({ value }) => value === true || value === 'true')
  @IsBoolean()
  overdue?: boolean;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(100)
  search?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  patientId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  bookingId?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize: number = 20;
}

export class PayhereCheckoutDto {
  @ApiPropertyOptional({ description: "For the PayHere receipt, when the client's account has no email" })
  @IsOptional() @Transform(trimToUndefined) @IsEmail({}, { message: 'Enter a valid email address' }) @MaxLength(255)
  email?: string;
}

// --- payouts -------------------------------------------------------------------

export class CreatePayoutDto {
  @ApiProperty()
  @IsUUID('all', { message: 'Choose the caregiver' })
  caregiverId: string;

  @ApiProperty({ example: '2026-10-01' })
  @Matches(DATE, { message: 'Enter the first day of the period' })
  periodStart: string;

  @ApiProperty({ example: '2026-10-31' })
  @Matches(DATE, { message: 'Enter the last day of the period' })
  periodEnd: string;
}

export class GeneratePayoutsDto {
  @ApiProperty({ example: '2026-10-01' })
  @Matches(DATE, { message: 'Enter the first day of the period' })
  periodStart: string;

  @ApiProperty({ example: '2026-10-31' })
  @Matches(DATE, { message: 'Enter the last day of the period' })
  periodEnd: string;
}

export class UpdatePayoutDto {
  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(2000, { message: 'Notes must be 2000 characters or fewer' })
  notes?: string;
}

export class PayPayoutDto {
  @ApiProperty({ example: '2026-11-03' })
  @Matches(DATE, { message: 'Enter the date it was paid' })
  paidOn: string;

  @ApiProperty({ enum: PAYMENT_TYPES, description: 'Cash, bank or online' })
  @IsIn(PAYMENT_TYPES, { message: 'Choose how it was paid' })
  paymentType: PaymentTypeValue;

  @ApiPropertyOptional({ enum: MANUAL_METHODS, description: 'Optional detail under the type, e.g. CHEQUE for a bank payment' })
  @IsOptional()
  @Transform(trimToUndefined)
  @IsIn(MANUAL_METHODS, { message: 'Choose a valid payment detail' })
  method?: ManualMethod;

  @ApiPropertyOptional({ description: 'Bank payments only: which of the business bank accounts (Settings > Billing)' })
  @IsOptional()
  @Transform(trimToUndefined)
  @IsUUID('all', { message: 'Choose a bank account' })
  bankAccountId?: string;

  @ApiPropertyOptional()
  @IsOptional() @Transform(trimToUndefined) @IsString() @MaxLength(120)
  reference?: string;

  @ApiPropertyOptional({ default: true })
  @IsOptional() @IsBoolean()
  notify?: boolean;
}

export class PayoutQueryDto {
  @ApiPropertyOptional({ enum: payoutStatusEnum })
  @IsOptional() @IsEnum(payoutStatusEnum)
  status?: (typeof payoutStatusEnum)[number];

  @ApiPropertyOptional()
  @IsOptional() @IsUUID()
  caregiverId?: string;

  @ApiPropertyOptional()
  @IsOptional() @IsString() @MaxLength(100)
  search?: string;

  @ApiPropertyOptional({ default: 1 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1)
  page: number = 1;

  @ApiPropertyOptional({ default: 20 })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(100)
  pageSize: number = 20;
}
