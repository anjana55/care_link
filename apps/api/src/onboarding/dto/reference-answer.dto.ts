import { IsBoolean, IsIn, IsOptional, IsString, Length, MaxLength } from 'class-validator';
import { REFERENCE_COMMENT_MAX, REFERENCE_TRUST, REFERENCE_YEARS, type ReferenceTrust, type ReferenceYears } from '@care-platform/shared';

export class ReferenceTokenDto {
  @IsString()
  @Length(20, 100, { message: 'This link is not valid or has expired' })
  token!: string;
}

export class ReferenceAnswerDto extends ReferenceTokenDto {
  @IsBoolean({ message: 'Say whether you know this person' })
  knowsThem!: boolean;

  @IsOptional()
  @IsIn(REFERENCE_YEARS, { message: 'Choose how long you have known them' })
  years?: ReferenceYears;

  @IsOptional()
  @IsIn(REFERENCE_TRUST, { message: 'Choose whether you would trust them' })
  wouldTrust?: ReferenceTrust;

  @IsOptional()
  @IsString()
  @MaxLength(REFERENCE_COMMENT_MAX, { message: 'Keep the comment under 500 characters' })
  comment?: string;
}
