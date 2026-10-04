import { useMemo } from 'react';
import { Controller, useWatch } from 'react-hook-form';
import type { Control, FieldErrors, UseFormRegister, UseFormSetValue } from 'react-hook-form';
import { Input, Label, FieldError, Select, Textarea } from '@/components/ui/input';
import type { LocationProvince } from '@/lib/api/types';
import { useCities } from '@/lib/hooks/use-caregivers';
import { useTranslation } from '@/lib/i18n/provider';

/**
 * The staff-editable half of a client's profile.
 *
 * Not a reuse of `PersonalInfoFields`: that renders a caregiver's civil status,
 * police division and three emergency-contact fields, none of which exist on
 * `patients`, and its generic signature needs `as any` casts at every call site.
 * The district/city cascade below IS reused wholesale, because it is the same
 * dependent-dropdown problem with the same solution.
 */
export function ClientProfileFields({
  register,
  control,
  setValue,
  errors,
  locationTree,
  locationsUnavailable = false,
  serverError,
}: {
  register: UseFormRegister<any>;
  control: Control<any>;
  setValue: UseFormSetValue<any>;
  errors: FieldErrors<any>;
  locationTree?: LocationProvince[];
  /** Whether the locations request failed. Without it, a failed fetch and a
   * genuinely empty locations table look identical: both dropdowns render with
   * no options and nothing on screen says why. */
  locationsUnavailable?: boolean;
  /** A server-side rejection (a duplicate number, a stale record) that no
   * field-level rule can predict. */
  serverError?: string | null;
}) {
  const { t, locale } = useTranslation();

  // District and city are a dependent pair, so they can't stay uncontrolled
  // like the rest: the city options derive from the selected district. Both go
  // through Controller/useWatch rather than local state, so the form stays the
  // single source of truth - mirroring the district in useState instead would
  // leave the form value and the rendered value disagreeing when a saved record
  // arrives via reset().
  const selectedDistrictId = useWatch({ control, name: 'districtId' }) ?? '';
  const selectedCityId = useWatch({ control, name: 'cityId' }) ?? '';

  // localeCompare(locale) makes the Sinhala and Tamil lists read in their own
  // order; a plain .sort() orders by code point, which puts them in an order no
  // Sinhala or Tamil reader would recognise.
  const districts = useMemo(
    () =>
      (locationTree ?? [])
        .flatMap((p) => p.districts)
        .sort((a, b) => a.name.localeCompare(b.name, locale)),
    [locationTree, locale],
  );

  const { data: districtCities = [] } = useCities(
    selectedDistrictId === '' ? null : Number(selectedDistrictId),
    locale,
  );

  const cities = useMemo(
    () => [...districtCities].sort((a, b) => a.name.localeCompare(b.name, locale)),
    [districtCities, locale],
  );

  // Shown read-only under the city dropdown rather than typed into it: 47 of
  // the postcodes carry a leading zero and 101 of the 2155 cities have none, so
  // this renders as a blank line in the latter case rather than an error.
  const selectedCity = useMemo(
    () => districtCities.find((c) => String(c.id) === String(selectedCityId)),
    [districtCities, selectedCityId],
  );

  const genderOptions = [
    { value: '', label: t('personalInfo.options.select') },
    { value: 'MALE', label: t('personalInfo.options.gender.MALE') },
    { value: 'FEMALE', label: t('personalInfo.options.gender.FEMALE') },
    { value: 'OTHER', label: t('personalInfo.options.gender.OTHER') },
  ];

  return (
    <div className="space-y-5">
      {serverError && (
        <p role="alert" className="rounded border border-danger/30 bg-danger/5 px-3 py-2 text-sm text-danger">
          {serverError}
        </p>
      )}

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <Label htmlFor="fullName" required>{t('personalInfo.fields.fullName')}</Label>
          <Input id="fullName" {...register('fullName')} />
          <FieldError message={errors.fullName?.message as string | undefined} />
        </div>

        {/* The contact number and the account email. Both are optional: a
            WhatsApp-only client has no email at all, and an email-registered
            client has no number on their account yet. */}
        <div>
          <Label htmlFor="phone">{t('clients.form.phone')}</Label>
          <Input id="phone" {...register('phone')} />
          <FieldError message={errors.phone?.message as string | undefined} />
          <p className="mt-1 text-xs text-ink/60">{t('clients.form.phoneHint')}</p>
        </div>

        <div>
          <Label htmlFor="email">{t('clients.form.email')}</Label>
          <Input id="email" type="email" {...register('email')} />
          <FieldError message={errors.email?.message as string | undefined} />
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="permanentAddress">{t('personalInfo.fields.permanentAddress')}</Label>
          <Textarea id="permanentAddress" rows={2} {...register('permanentAddress')} />
          <FieldError message={errors.permanentAddress?.message as string | undefined} />
        </div>

        <div>
          <Label htmlFor="dateOfBirth">{t('personalInfo.fields.dateOfBirth')}</Label>
          <Input id="dateOfBirth" type="date" {...register('dateOfBirth')} />
          <FieldError message={errors.dateOfBirth?.message as string | undefined} />
        </div>

        <div>
          <Label htmlFor="gender">{t('personalInfo.fields.gender')}</Label>
          <Select id="gender" {...register('gender')}>
            {genderOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
          <FieldError message={errors.gender?.message as string | undefined} />
        </div>

        <div>
          <Label htmlFor="nic">{t('personalInfo.fields.nic')}</Label>
          <Input id="nic" {...register('nic')} />
          <FieldError message={errors.nic?.message as string | undefined} />
        </div>

        <div>
          {locationsUnavailable && (
            <p role="alert" className="mb-2 rounded border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
              {t('common.locationsUnavailable')}
            </p>
          )}
          <Label htmlFor="district">{t('personalInfo.fields.district')}</Label>
          <Controller
            name="districtId"
            control={control}
            render={({ field }) => (
              <Select
                id="district"
                ref={field.ref}
                value={field.value ?? ''}
                onChange={(e) => {
                  field.onChange(e);
                  // Cities are scoped to a district, so a city picked under the
                  // old district is no longer on the list. Clear it rather than
                  // submitting a pair the API would reject with a 400. Guarded
                  // so re-picking the same district - what happens when the
                  // form loads a saved record - doesn't wipe the city that just
                  // came back from the server.
                  // Compare numerically: e.target.value is always a string,
                  // while field.value is the number from the loaded record, so
                  // a plain !== would report a change on every re-pick.
                  if (Number(e.target.value) !== Number(field.value)) {
                    setValue('cityId', '');
                  }
                }}
              >
                <option value="">{t('personalInfo.options.select')}</option>
                {districts.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </Select>
            )}
          />
          <FieldError message={errors.districtId?.message as string | undefined} />
        </div>

        <div>
          <Label htmlFor="city">{t('personalInfo.fields.city')}</Label>
          <Controller
            name="cityId"
            control={control}
            render={({ field }) => (
              <Select
                id="city"
                ref={field.ref}
                value={field.value ?? ''}
                onChange={field.onChange}
                disabled={!selectedDistrictId}
              >
                <option value="">{t('personalInfo.options.select')}</option>
                {cities.map((c) => (
                  // 16 of the cities carry a second name in the source data;
                  // folding it in keeps "Colombo 03 - Modara" distinguishable
                  // from the bare division name.
                  <option key={c.id} value={c.id}>
                    {c.subName ? `${c.name} - ${c.subName}` : c.name}
                  </option>
                ))}
              </Select>
            )}
          />
          <FieldError message={errors.cityId?.message as string | undefined} />
          {/* Derived from the selected city by the API, so shown rather than
              submitted. A district with no city picked has nothing to show. */}
          <p className="mt-1 text-xs text-ink/60" aria-live="polite">
            {selectedCity?.postcode
              ? `${t('personalInfo.fields.postalCode')}: ${selectedCity.postcode}`
              : ''}
          </p>
        </div>

        <div className="sm:col-span-2">
          <Label htmlFor="notes">{t('clients.form.notes')}</Label>
          <Textarea id="notes" rows={3} {...register('notes')} />
          <FieldError message={errors.notes?.message as string | undefined} />
        </div>
      </div>
    </div>
  );
}