import { z } from 'zod';
import { makePersonalInfoSchema, requiredFieldsOf } from './personal-info';

/**
 * The one caregiver registration form.
 *
 * Built on the shared personal-information schema so the rules stay in one
 * place, but with `primaryPhone` removed: this form asks for `phone` once, in
 * its own account section, and the API writes that single value to both
 * `users.phone` and `caregivers.primaryPhone`. Keeping the omitted field would
 * let the duplicate number back in - the WhatsApp page has that exact problem
 * today, which is why `primaryPhone` is optional there and overridden
 * server-side.
 */
export function makeUnifiedSignupSchema(t: (key: string) => string) {
  const base = makePersonalInfoSchema(t).omit({ primaryPhone: true });

  const schema = base.extend({
    // Required, and the only number this form collects. Labelled "Phone
    // number" rather than "WhatsApp number" - it is how staff reach the
    // caregiver, and on this route it is not verified over WhatsApp at all.
    phone: z
      .string()
      .trim()
      .min(1, t('caregiverSignup.validation.phoneRequired'))
      .min(9, t('caregiverSignup.validation.phoneInvalid')),
    // Optional. If given, it must be the address they later verify with
    // Google/Microsoft/Facebook, which the API enforces when it links the
    // provider identity.
    email: z
      .string()
      .trim()
      .email(t('caregiverSignup.validation.emailInvalid'))
      .optional()
      .or(z.literal('')),
    consentAccepted: z.boolean(),
  });

  return schema.refine((d) => d.consentAccepted === true, {
    message: t('caregiverRegister.validation.consentRequired'),
    path: ['consentAccepted'],
  });
}

/**
 * The mandatory-field set for the shared block, minus `primaryPhone`.
 *
 * Pass the unrefined object: `.refine()` returns a ZodEffects with no `.shape`,
 * so `requiredFieldsOf` cannot read it.
 */
export function unifiedSignupRequiredFields(t: (key: string) => string) {
  return requiredFieldsOf(
    makePersonalInfoSchema(t).omit({ primaryPhone: true }),
  );
}

export type UnifiedSignupValues = z.infer<ReturnType<typeof makeUnifiedSignupSchema>>;