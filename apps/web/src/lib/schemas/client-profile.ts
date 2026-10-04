import { z } from 'zod';
import type { ClientGender } from '../api/types';

export type ClientProfileValues = z.infer<ReturnType<typeof makeClientProfileSchema>>;

/**
 * What form.reset() writes for a location id the record does not have: ''.
 *
 * The schema's own type says number, so this needs the cast - named once here
 * rather than repeated at every reset() call. Validated as an unset value by
 * unsetId() below, not rejected as a 0.
 *
 * Note this is declared here rather than imported from the caregiver schema:
 * that file has its own copy, and the two forms are allowed to drift apart.
 */
export const UNSET_ID = '' as unknown as number;

const GENDERS = ['MALE', 'FEMALE', 'OTHER'] as const satisfies readonly ClientGender[];

/**
 * An optional location id as the form holds it: a `<select>` submits a string,
 * so a picked id arrives as '340' and the "nothing chosen" option as ''. Blank
 * is mapped to undefined *before* coercion, because coercing first would make
 * it 0 - a real id shape that .positive() rightly rejects.
 */
const unsetId = () =>
  z.preprocess(
    (v) => (v === '' || v === null ? undefined : v),
    z.coerce.number().int().positive().optional(),
  );

/**
 * Every field except the name is optional here, unlike the caregiver intake
 * form. A client did not come through this form - they self-registered with
 * whatever they had, and staff are filling the rest in over time. Forcing an
 * address or a district on a record that has been live for months would mean
 * inventing data, not correcting it.
 *
 * The messages for fullName are reused verbatim from `personalInfo.validation`
 * so the same rule reads identically in the caregiver form and here; the phone
 * and email rules are client-specific (a client's number is optional and free
 * text, and their email belongs to the linked login account).
 */
export function makeClientProfileSchema(t: (key: string) => string) {
  const required = (field: string) => t(`personalInfo.validation.${field}.required`);
  const invalid = (field: string) => t(`personalInfo.validation.${field}.invalid`);

  return z.object({
    fullName: z.string().trim().min(1, required('fullName')).min(2, invalid('fullName')),
    // Blank is legal and means "leave the account email alone". A WhatsApp-only
    // client has no email at all, and form.reset writes '' for them - without
    // the literal('') arm, z.string().email() rejects '' and the form becomes
    // unsubmittable for exactly the clients most in need of editing.
    email: z.union([z.literal(''), z.string().trim().email(t('clients.validation.email.invalid'))]),
    // Optional and unconstrained on shape: the column stores whatever spelling
    // it was given, so a re-submit of the value already there has to be
    // acceptable. Whether the number is usable is normalizePhone's call,
    // server-side - one authority for that rule, not two that can disagree.
    phone: z.string().trim().max(20, t('clients.validation.phone.tooLong')),
    permanentAddress: z.string().trim(),
    nic: z.string().trim().max(20, t('clients.validation.nic.tooLong')),
    // Optional, but a blank date input must be a valid empty value rather than
    // a string the server would reject - the API treats '' as an error, so the
    // submit handler omits the key entirely instead (see use-clients.ts).
    dateOfBirth: z.string(),
    // A select can only ever submit '' or a valid member.
    gender: z.union([z.literal(''), z.enum(GENDERS)]),
    // A blank select is '' and must validate as "unset", not as 0.
    // z.coerce.number turns '' into 0 and .positive() rejects it - and
    // .optional() does NOT rescue that, because it only short-circuits on a
    // genuinely absent undefined, not on a present ''. Every client has these
    // null today (self-registration writes only name/phone/consent), so
    // without this preprocessing the form is unsubmittable for all of them.
    // The blank is then omitted from the payload by the submit handler.
    districtId: unsetId(),
    cityId: unsetId(),
    notes: z.string().trim().max(2000, t('clients.validation.notes.tooLong')),
  });
}