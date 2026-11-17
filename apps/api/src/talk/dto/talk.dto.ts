import { Transform, Type } from 'class-transformer';
import { IsIn, IsOptional, IsString, IsUUID, Length, MaxLength, ValidateNested } from 'class-validator';
import { TALK_ABOUT_TYPES, TALK_CONTACT_METHODS, TALK_MESSAGE_MAX, TALK_MESSAGE_MIN, type TalkAboutType, type TalkContactMethod } from '@care-platform/shared';

const trim = ({ value }: { value: unknown }) => (typeof value === 'string' ? value.trim() : value);

class TalkAboutDto {
  @IsIn(TALK_ABOUT_TYPES)
  type!: TalkAboutType;

  @IsUUID('4')
  id!: string;
}

export class TalkRequestDto {
  @Transform(trim)
  @IsString()
  @Length(TALK_MESSAGE_MIN, TALK_MESSAGE_MAX, { message: 'Tell us in a few words what you need (up to 1000 characters)' })
  message!: string;

  @IsIn(TALK_CONTACT_METHODS, { message: 'Choose how we should contact you' })
  contact!: TalkContactMethod;

  @IsOptional()
  @ValidateNested()
  @Type(() => TalkAboutDto)
  about?: TalkAboutDto;
}

export class HandleTalkRequestDto {
  @IsOptional()
  @Transform(trim)
  @IsString()
  @MaxLength(500, { message: 'Keep the note under 500 characters' })
  note?: string;
}
