import { PartialType } from '@nestjs/swagger';
import { CreateQualificationDto } from './create-qualification.dto';

/**
 * A class, not `Partial<CreateQualificationDto>`: a type alias is erased at
 * runtime, so the validation pipe saw a plain object and its whitelist stripped
 * nothing. That let a caregiver PATCH `verificationStatus` (or `caregiverId`)
 * straight onto their own record.
 */
export class UpdateQualificationDto extends PartialType(CreateQualificationDto) {}
