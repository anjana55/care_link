import { useMemo } from 'react';
import { Controller, useWatch } from 'react-hook-form';
import type { Control, FieldErrors, UseFormRegister, UseFormSetValue } from 'react-hook-form';
import { Input, Label, FieldError, Select, Textarea } from '@/components/ui/input';
import type { PublicMetaLocation } from '@care-platform/shared';
import type { PersonalInfoValues } from '@/lib/schemas/personal-info';
import { useTranslation } from '@/lib/i18n';

/**
 * The shared caregiver personal-information block, moved from apps/web so
 * caregiver self-registration can live on the public site instead of under
 * the `/staff` basePath.
 *
 * `PublicMetaLocation` (from the public search metadata) stands in for
 * apps/web's own `Location`: both are `{ id, district, city, province }`, and
 * the public one is already fetched by `useMetaLocations()` here, so there is
 * no need to port the 341-line staff hook file for a single dropdown pair.
 */
export function PersonalInfoFields<T extends PersonalInfoValues>({
  register,
  control,
  setValue,
  errors,
  locations,
  locationsUnavailable = false,
  requiredFields,
}: {
  register: UseFormRegister<T>;
  control: Control<T>;
  setValue: UseFormSetValue<T>;
  errors: FieldErrors<T>;
  locations?: PublicMetaLocation[];
  /**
   * Whether the locations request failed. Without it a failed fetch and a
   * genuinely empty locations table look identical: `locations` is undefined,
   * both dropdowns render with no options, and nothing on screen says why.
   */
  locationsUnavailable?: boolean;
  /** Field names the schema enforces, from requiredFieldsOf(). */
  requiredFields: ReadonlySet<string>;
}) {
  const { t } = useTranslation();

  // District and city are a dependent pair, so they can't stay uncontrolled
  // like the rest of the form: the city options are derived from the selected
  // district. Both are wired through Controller/useWatch rather than kept in
  // local state, so the form stays the single source of truth. Mirroring the
  // district in useState instead would leave the form value and the rendered
  // value disagreeing - on the edit screen the caregiver's saved district
  // arrives via form.reset() and the dropdown would still read blank.
  const selectedDistrict = useWatch({ control, name: 'district' as any }) ?? '';

  const districts = useMemo(() => {
    const unique = new Set((locations ?? []).map((l) => l.district));
    return Array.from(unique).sort();
  }, [locations]);

  const cities = useMemo(() => {
    if (!selectedDistrict) return [];
    const unique = new Set(
      (locations ?? [])
        .filter((l) => l.district === selectedDistrict)
        .map((l) => l.city),
    );
    return Array.from(unique).sort();
  }, [locations, selectedDistrict]);

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
      <div className="sm:col-span-2">
        <Label htmlFor="fullName" required={requiredFields.has('fullName')}>{t('personalInfo.fields.fullName')}</Label>
        <Input id="fullName" {...register('fullName' as any)} />
        <FieldError message={errors.fullName?.message as string | undefined} />
      </div>

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
        <Label htmlFor="district" required={requiredFields.has('district')}>{t('personalInfo.fields.district')}</Label>
        <Controller
          name={'district' as any}
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
                  setValue('city' as any, '' as any);
                }
              }}
            >
              <option value="">{t('personalInfo.options.select')}</option>
              {districts.map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </Select>
          )}
        />
        <FieldError message={errors.district?.message as string | undefined} />
      </div>

      <div>
        <Label htmlFor="city" required={requiredFields.has('city')}>{t('personalInfo.fields.city')}</Label>
        <Controller
          name={'city' as any}
          control={control}
          render={({ field }) => (
            <Select
              id="city"
              ref={field.ref}
              value={field.value ?? ''}
              onChange={field.onChange}
              disabled={!selectedDistrict}
            >
              <option value="">{t('personalInfo.options.select')}</option>
              {cities.map((c) => (
                <option key={c} value={c}>{c}</option>
              ))}
            </Select>
          )}
        />
        <FieldError message={errors.city?.message as string | undefined} />
      </div>

      <div>
        <Label htmlFor="postalCode" required={requiredFields.has('postalCode')}>{t('personalInfo.fields.postalCode')}</Label>
        <Input id="postalCode" type="text" {...register('postalCode' as any)} />
        <FieldError message={errors.postalCode?.message as string | undefined} />
      </div>

      <div>
        <Label htmlFor="nic" required={requiredFields.has('nic')}>{t('personalInfo.fields.nic')}</Label>
        <Input id="nic" {...register('nic' as any)} />
      </div>
      <div>
        <Label htmlFor="passportNumber" required={requiredFields.has('passportNumber')}>{t('personalInfo.fields.passportNumber')}</Label>
        <Input id="passportNumber" {...register('passportNumber' as any)} />
      </div>

      <div>
        <Label htmlFor="dateOfBirth" required={requiredFields.has('dateOfBirth')}>{t('personalInfo.fields.dateOfBirth')}</Label>
        <Input id="dateOfBirth" type="date" {...register('dateOfBirth' as any)} />
        <FieldError message={errors.dateOfBirth?.message as string | undefined} />
      </div>
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

      <div>
        <Label htmlFor="primaryPhone" required={requiredFields.has('primaryPhone')}>{t('personalInfo.fields.primaryPhone')}</Label>
        <Input id="primaryPhone" {...register('primaryPhone' as any)} />
      </div>
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