import {
  registerDecorator,
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraint,
  ValidatorConstraintInterface,
} from 'class-validator';
import type { SearchRequestDto } from './search-request.dto';

/**
 * District and desired start date are the only mandatory inputs on the public
 * search form; everything else is a refinement. This is a single class-level
 * constraint rather than per-field `@IsNotEmpty` for two reasons:
 *
 *  - a request that omits `location` entirely and one that sends
 *    `location: {}` should both fail naming the field the caller has to fix,
 *    which per-field validation cannot do (no `location` means no `district`
 *    to decorate).
 *  - it names exactly one missing field at a time, so the API's 400 mirrors
 *    the form's inline error instead of reporting every missing field at once.
 *
 * Mirrors the `superRefine` block on `searchRequestSchema` in @care-platform/shared.
 */
@ValidatorConstraint({ name: 'requireSearchCriteria', async: false })
export class RequireSearchCriteriaConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const dto = args.object as SearchRequestDto;
    return Boolean(dto.location?.district?.trim()) && Boolean(dto.desiredStartDate?.trim());
  }

  defaultMessage(args: ValidationArguments): string {
    const dto = args.object as SearchRequestDto;
    if (!dto.location?.district?.trim()) return 'location.district is required';
    return 'desiredStartDate is required';
  }
}

/**
 * Applies {@link RequireSearchCriteriaConstraint} to the DTO as a whole.
 * class-validator has no native class-level decorator, so this hangs the
 * constraint off a declared property; the property is never sent by a client
 * and its value is ignored - the constraint reads the object passed to it.
 */
export function RequireSearchCriteria(validationOptions?: ValidationOptions) {
  return function (object: object, propertyName: string): void {
    registerDecorator({
      target: object.constructor,
      propertyName,
      // No `message` override here on purpose: it would shadow the constraint's
      // own defaultMessage, which is what names the specific missing field.
      options: validationOptions,
      constraints: [],
      validator: RequireSearchCriteriaConstraint,
    });
  };
}
