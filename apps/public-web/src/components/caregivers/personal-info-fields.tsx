import { useMemo } from 'react';
import { Controller, useWatch } from 'react-hook-form';
import type { Control, FieldErrors, UseFormRegister, UseFormSetValue } from 'react-hook-form';
import { Input, Label, FieldError, Select, Textarea } from '@/components/ui/input';
import type { PublicLocationTree } from '@care-platform/shared';
import { useCities } from '@/lib/hooks/use-public-search';
import type { PersonalInfoValues } from '@/lib/schemas/personal-info';
import { useTranslation } from '@/lib/i18n';

/**
 * The shared caregiver personal-information block, moved from apps/web so
 * caregiver self-registration can live on the public site instead of under
 * the `/staff` basePath.
 *
 * Location is a pair of ids with names supplied by the API in the reader's
 * language: the district options come from the province -> district tree, the
 * city options from that district alone. The dropdowns offer ids as values,
 * so what the form submits is what search and ranking actually match on - and
 * there is no postal code to type, because the city record already carries it.
 */
export function PersonalInfoFields<T extends PersonalInfoValues>({
  register,
  control,
  setValue,
  errors,
  locationTree,
  locationsUnavailable = false,
  requiredFields,
  omitFields,
}: {
  register: UseFormRegister<T>;
  control: Control<T>;
  setValue: UseFormSetValue<T>;
  errors: FieldErrors<T>;
  locationTree?: PublicLocationTree;
  /**
   * Whether the locations request failed. Without it a failed fetch and a
   * genuinely empty locations table look identical: `locationTree` is undefined,
   * both dropdowns render with no options, and nothing on screen says why.
   */
  locationsUnavailable?: boolean;
  /** Field names the schema enforces, from requiredFieldsOf(). */
  requiredFields: ReadonlySet<string>;
  /**
   * Field names to leave out entirely: `primaryPhone` and the identity fields
   * (`fullName`, `nic`, `passportNumber`, `dateOfBirth`, `gender`). The profile
   * page uses the latter when verification has locked them.
   *
   * The unified sign-up renders its own `phone` input in the account section,
   * because on that form the number is called a phone number rather than a
   * primary phone - asking for both `phone` and `primaryPhone` is exactly the
   * duplicate field this flow exists to remove. Omitting rather than
   * duplicating is what keeps the two inputs from reappearing.
   */
  omitFields?: ReadonlySet<string>;
}) {
  const { t, locale } = useTranslation();
  // Anything the caller lists in `omitFields` is not rendered at all.
  const show = (field: string) => !omitFields?.has(field);

  // District and city are a dependent pair, so they can't stay uncontrolled
  // like the rest of the form: the city options are derived from the selected
  // district. Both are wired through Controller/useWatch rather than kept in
  // local state, so the form stays the single source of truth. Mirroring the
  // district in useState instead would leave the form value and the rendered
  // value disagreeing - on the edit screen the caregiver's saved district
  // arrives via form.reset() and the dropdown would still read blank.
  // Ids, not names. `''` is "nothing chosen" and never reaches the API: the
  // schema rejects a non-positive number, so an untouched select blocks submit
  // with the same "required" message a blank one always produced.
  const selectedDistrictId = useWatch({ control, name: 'districtId' as any }) ?? '';
  const selectedCityId = useWatch({ control, name: 'cityId' as any }) ?? '';

  // localeCompare(locale) is what makes the Sinhala and Tamil lists read in
  // their own order; a plain .sort() orders by code point, which puts them in
  // an order no Sinhala or Tamil reader would recognise.
  const districts = useMemo(
    () =>
      (locationTree ?? [])
        .flatMap((p) => p.districts)
        .sort((a, b) => a.name.localeCompare(b.name, locale)),
    [locationTree, locale],
  );

  // Fetched here rather than passed in: the district is only known once the
  // form state has it, and threading it back out to the page only to hand it
  // straight back in would put the dependent-dropdown logic in two places.
  const { data: districtCities = [] } = useCities(
    selectedDistrictId === '' ? null : Number(selectedDistrictId),
    locale,
  );

  const cities = useMemo(
    () => [...districtCities].sort((a, b) => a.name.localeCompare(b.name, locale)),
    [districtCities, locale],
  );

  // Shown read-only under the city dropdown rather than typed into it. 47 of
  // the postcodes carry a leading zero and 101 of the 2155 cities have none at
  // all, so this renders as a blank line in the latter case, not as an error.
  const selectedCity = useMemo(
    () => districtCities.find((c) => String(c.id) === String(selectedCityId)),
    [districtCities, selectedCityId],
  );

  const genderOptions = [
    { value: '', label: t('personalInfo.options.select') },
    { value: 'MALE', label: t('personalInfo.options.gender.MALE') },
    { value: 'FEMALE', label: t('personalInfo.options.gender.FEMALE') },
    { value: 'OTHER', label: t('personalInfo.options.gender.OTHER') }
  ];

  const civilStatusOptions = [
    { value: '', label: t('personalInfo.options.select') },
    { value: 'SINGLE', label: t('personalInfo.options.civilStatus.SINGLE') },
    { value: 'MARRIED', label: t('personalInfo.options.civilStatus.MARRIED') },
    { value: 'DIVORCED', label: t('personalInfo.options.civilStatus.DIVORCED') },
    { value: 'WIDOWED', label: t('personalInfo.options.civilStatus.WIDOWED') },
    { value: 'OTHER', label: t('personalInfo.options.civilStatus.OTHER') }
  ];

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
      {show('fullName') && (
        <div className="sm:col-span-2">
          <Label htmlFor="fullName" required={requiredFields.has('fullName')}>{t('personalInfo.fields.fullName')}</Label>
          <Input id="fullName" {...register('fullName' as any)} />
          <FieldError message={errors.fullName?.message as string | undefined} />
        </div>
      )}

      <div className="sm:col-span-2">
        <Label htmlFor="permanentAddress" required={requiredFields.has('permanentAddress')}>{t('personalInfo.fields.permanentAddress')}</Label>
        <Textarea id="permanentAddress" rows={2} {...register('permanentAddress' as any)} />
        <FieldError message={errors.permanentAddress?.message as string | undefined} />
      </div>

      <div>
        {locationsUnavailable && (
          <p role="alert" className="mb-2 rounded border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
            {t('common.locationsUnavailable')}
          </p>
        )}
        <Label htmlFor="district" required={requiredFields.has('districtId')}>{t('personalInfo.fields.district')}</Label>
        <Controller
          name={'districtId' as any}
          control={control}
          render={({ field }) => (
            <Select
              id="district"
              ref={field.ref}
              value={field.value ?? ''}
              onChange={(e) => {
                field.onChange(e);
                // Cities are scoped to a district, so a city picked under the
                // old district is no longer on the list. Clear it instead of
                // submitting a city that doesn't belong to the district.
                // Guarded so re-picking the same district (which is what
                // happens when the edit screen loads a saved record) doesn't
                // wipe the city that just came back from the server.
                if (e.target.value !== field.value) {
                  setValue('cityId' as any, '' as any);
                }
              }}
            >
              <option value="">{t('personalInfo.options.select')}</option>
              {districts.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </Select>
          )}
        />
        <FieldError message={(errors as any).districtId?.message as string | undefined} />
      </div>

      <div>
        <Label htmlFor="city" required={requiredFields.has('cityId')}>{t('personalInfo.fields.city')}</Label>
        <Controller
          name={'cityId' as any}
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
                // folding it into the label keeps "Colombo 03 - Modara"
                // distinguishable from the bare division name.
                <option key={c.id} value={c.id}>{c.subName ? `${c.name} - ${c.subName}` : c.name}</option>
              ))}
            </Select>
          )}
        />
        <FieldError message={(errors as any).cityId?.message as string | undefined} />
        {/* Derived from the selected city by the API, so it is shown rather
            than submitted. A district with no city picked yet has nothing to
            show, and the label stays put so the row does not jump. */}
        <p className="mt-1 text-xs text-ink/60" aria-live="polite">
          {selectedCity?.postcode
            ? `${t('personalInfo.fields.postalCode')}: ${selectedCity.postcode}`
            : ''}
        </p>
      </div>

      {show('nic') && (
        <div>
          <Label htmlFor="nic" required={requiredFields.has('nic')}>{t('personalInfo.fields.nic')}</Label>
          <Input id="nic" {...register('nic' as any)} />
        </div>
      )}
      {show('passportNumber') && (
        <div>
          <Label htmlFor="passportNumber" required={requiredFields.has('passportNumber')}>{t('personalInfo.fields.passportNumber')}</Label>
          <Input id="passportNumber" {...register('passportNumber' as any)} />
        </div>
      )}

      {show('dateOfBirth') && (
        <div>
          <Label htmlFor="dateOfBirth" required={requiredFields.has('dateOfBirth')}>{t('personalInfo.fields.dateOfBirth')}</Label>
          <Input id="dateOfBirth" type="date" {...register('dateOfBirth' as any)} />
          <FieldError message={errors.dateOfBirth?.message as string | undefined} />
        </div>
      )}
      {show('gender') && (
        <div>
          <Label htmlFor="gender" required={requiredFields.has('gender')}>{t('personalInfo.fields.gender')}</Label>
          <Select id="gender" {...register('gender' as any)}>
            {genderOptions.map(opt => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </Select>
          <FieldError message={errors.gender?.message as string | undefined} />
        </div>
      )}

      <div>
        <Label htmlFor="civilStatus" required={requiredFields.has('civilStatus')}>{t('personalInfo.fields.civilStatus')}</Label>
        <Select id="civilStatus" {...register('civilStatus' as any)}>
          {civilStatusOptions.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
        <FieldError message={errors.civilStatus?.message as string | undefined} />
      </div>

      <div>
        <Label htmlFor="heightIn" required={requiredFields.has('heightIn')}>{t('personalInfo.fields.heightIn')}</Label>
        <Input id="heightIn" type="number" step="0.1" {...register('heightIn' as any)} />
      </div>
      <div>
        <Label htmlFor="weightKg" required={requiredFields.has('weightKg')}>{t('personalInfo.fields.weightKg')}</Label>
        <Input id="weightKg" type="number" {...register('weightKg' as any)} />
      </div>

      {omitFields?.has('primaryPhone') ? (
        // The unified form renders its own `phone` input, in the account
        // section where the other credentials are. This spacer keeps
        // secondaryPhone in the right-hand column: without it the whole grid
        // shifts left by one from here on, which is the trap the emergency
        // group's filler below already documents.
        <div />
      ) : (
        <div>
          <Label htmlFor="primaryPhone" required={requiredFields.has('primaryPhone')}>{t('personalInfo.fields.primaryPhone')}</Label>
          <Input id="primaryPhone" {...register('primaryPhone' as any)} />
        </div>
      )}
      <div>
        <Label htmlFor="secondaryPhone" required={requiredFields.has('secondaryPhone')}>{t('personalInfo.fields.secondaryPhone')}</Label>
        <Input id="secondaryPhone" {...register('secondaryPhone' as any)} />
      </div>

      <div>
        <Label htmlFor="emergencyContactName" required={requiredFields.has('emergencyContactName')}>{t('personalInfo.fields.emergencyContactName')}</Label>
        <Input id="emergencyContactName" {...register('emergencyContactName' as any)} />
        <FieldError message={errors.emergencyContactName?.message as string | undefined} />
      </div>
      <div>
        <Label htmlFor="emergencyContactNumber" required={requiredFields.has('emergencyContactNumber')}>{t('personalInfo.fields.emergencyContactNumber')}</Label>
        <Input id="emergencyContactNumber" {...register('emergencyContactNumber' as any)} />
        <FieldError message={errors.emergencyContactNumber?.message as string | undefined} />
      </div>
      <div>
        <Label htmlFor="emergencyContactRelationship" required={requiredFields.has('emergencyContactRelationship')}>{t('personalInfo.fields.emergencyContactRelationship')}</Label>
        <Input id="emergencyContactRelationship" {...register('emergencyContactRelationship' as any)} />
        <FieldError message={errors.emergencyContactRelationship?.message as string | undefined} />
      </div>
      {/* Load-bearing. The emergency group has three fields, so it leaves a
          half-empty row; without this filler the police pair would flow into
          that gap and land one column apart. Only ever add an empty cell to
          pad the *end* of a group - one in the middle shifts every field
          after it, splitting the following pair across two rows. */}
      <div />

      <div>
        <Label htmlFor="policeDivision" required={requiredFields.has('policeDivision')}>{t('personalInfo.fields.policeDivision')}</Label>
        <Input id="policeDivision" {...register('policeDivision' as any)} />
      </div>
      <div>
        <Label htmlFor="policeStation" required={requiredFields.has('policeStation')}>{t('personalInfo.fields.policeStation')}</Label>
        <Input id="policeStation" {...register('policeStation' as any)} />
      </div>
    </div>
  );
}