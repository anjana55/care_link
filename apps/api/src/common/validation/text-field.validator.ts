import { registerDecorator, ValidationArguments, ValidationOptions } from 'class-validator';

export interface TextFieldOptions {
  /** Shortest accepted value, counted after trimming. Omit for a presence-only field. */
  min?: number;
  /** Longest accepted value, counted after trimming. */
  max?: number;
  requiredMessage: string;
  invalidMessage: string;
  validationOptions?: ValidationOptions;
}

/**
 * One constraint that reports exactly one message, chosen by *why* the value
 * was rejected: blank (including omitted) gets `requiredMessage`, wrong-but-
 * present gets `invalidMessage`.
 *
 * This exists because the obvious spelling of the same thing - @IsNotEmpty
 * stacked above @MinLength - makes class-validator report every failing
 * constraint, so an empty field produces two errors at once ("Full name is
 * required" *and* "at least 2 characters"). Having a single message per field
 * is also what lets these strings match the client-side Zod messages one for
 * one, which the caregiver DTOs are written against.
 */
export function TextField(options: TextFieldOptions) {
  return function (object: object, propertyName: string) {
    registerDecorator({
      name: 'textField',
      target: object.constructor,
      propertyName,
      options: options.validationOptions,
      validator: {
        validate(value: unknown): boolean {
          if (value === undefined || value === null) return false;
          // Non-strings are @IsString's business; reporting "is required" for a
          // number would be a lie about what the caller actually sent.
          if (typeof value !== 'string') return true;
          const trimmed = value.trim();
          if (trimmed === '') return false;
          if (options.min !== undefined && trimmed.length < options.min) return false;
          if (options.max !== undefined && trimmed.length > options.max) return false;
          return true;
        },
        defaultMessage(args: ValidationArguments): string {
          const value = args.value;
          if (value === undefined || value === null) return options.requiredMessage;
          if (typeof value === 'string' && value.trim() === '') return options.requiredMessage;
          return options.invalidMessage;
        },
      },
    });
  };
}
