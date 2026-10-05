import { useMemo } from 'react';
import { Controller, useWatch } from 'react-hook-form';
import type { Control, FieldErrors, UseFormRegister, UseFormSetValue } from 'react-hook-form';
import type { PublicLocationTree } from '@care-platform/shared';
import { FieldError, Input, Label, Select, Textarea } from '@/components/ui/input';
import { useCities } from '@/lib/hooks/use-public-search';
import { useTranslation } from '@/lib/i18n';
import type { PatientIntakeValues } from '@/lib/schemas/patient-intake';
import {
  CAREGIVER_GENDER_PREFERENCES,
  CARE_SCHEDULES,
  CARE_STARTS,
  CONTACT_METHODS,
  CONTACT_TIMES,
  GENDERS,
  RELATIONSHIPS,
  REGISTRANT_TYPES,
} from '@/lib/schemas/patient-intake';

/* The form is shared by two pages whose value types both extend
 * PatientIntakeValues, so the component is generic over that and addresses
 * fields by name; the schema in lib/schemas/patient-intake.ts is what actually
 * types and validates them (same approach as PersonalInfoFields). */
/* eslint-disable @typescript-eslint/no-explicit-any */

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <fieldset className="space-y-4 border-t border-border pt-5">
      <legend className="mb-1 pr-2 text-sm font-semibold text-ink">{title}</legend>
      {children}
    </fieldset>
  );
}

/**
 * Everything a client registration asks beyond who they are and how they sign
 * in: who needs care, how and when to contact them, where, and what care.
 * This is what staff use to call the client back and match a caregiver.
 */
export function PatientIntakeFields<T extends PatientIntakeValues>({
  register,
  control,
  setValue,
  errors,
  locationTree,
  locationsUnavailable = false,
  allowEmailContact,
}: {
  register: UseFormRegister<T>;
  control: Control<T>;
  setValue: UseFormSetValue<T>;
  errors: FieldErrors<T>;
  locationTree?: PublicLocationTree;
  locationsUnavailable?: boolean;
  /** False for WhatsApp sign-ups, which have no email address to contact. */
  allowEmailContact: boolean;
}) {
  const { t, locale } = useTranslation();
  const err = (name: string) => (errors as any)[name]?.message as string | undefined;

  const registrantType = useWatch({ control, name: 'registrantType' as any });
  const guardian = registrantType === 'GUARDIAN';
  const selectedDistrictId = useWatch({ control, name: 'districtId' as any }) ?? '';
  const selectedCityId = useWatch({ control, name: 'cityId' as any }) ?? '';

  // localeCompare(locale) so the Sinhala and Tamil lists read in their own order.
  const districts = useMemo(
    () => (locationTree ?? []).flatMap((p) => p.districts).sort((a, b) => a.name.localeCompare(b.name, locale)),
    [locationTree, locale],
  );
  const { data: districtCities = [] } = useCities(selectedDistrictId === '' ? null : Number(selectedDistrictId), locale);
  const cities = useMemo(() => [...districtCities].sort((a, b) => a.name.localeCompare(b.name, locale)), [districtCities, locale]);
  const selectedCity = districtCities.find((c) => String(c.id) === String(selectedCityId));

  const options = (group: string, values: readonly string[]) =>
    values.map((value) => (
      <option key={value} value={value}>
        {t(`patientIntake.options.${group}.${value}`)}
      </option>
    ));
  const choose = <option value="">{t('personalInfo.options.select')}</option>;
  const contactMethods = allowEmailContact ? CONTACT_METHODS : CONTACT_METHODS.filter((m) => m !== 'EMAIL');

  return (
    <div className="space-y-5">
      <Section title={t('patientIntake.sections.whoNeedsCare')}>
        <div role="radiogroup" aria-label={t('patientIntake.sections.whoNeedsCare')} className="grid gap-2 sm:grid-cols-2">
          {REGISTRANT_TYPES.map((type) => (
            <label key={type} className="flex cursor-pointer items-start gap-2 rounded border border-border p-3 text-sm text-ink has-[:checked]:border-brand has-[:checked]:bg-brand-light/40">
              <input type="radio" value={type} className="mt-0.5 h-4 w-4 text-brand focus:ring-brand" {...register('registrantType' as any)} />
              <span>{t(`patientIntake.options.registrantType.${type}`)}</span>
            </label>
          ))}
        </div>
        <FieldError message={err('registrantType')} />

        {guardian && (
          <>
            <div>
              <Label htmlFor="recipientName" required>{t('patientIntake.fields.recipientName')}</Label>
              <Input id="recipientName" {...register('recipientName' as any)} />
              <FieldError message={err('recipientName')} />
            </div>
            <div>
              <Label htmlFor="recipientRelationship" required>{t('patientIntake.fields.relationship')}</Label>
              <Select id="recipientRelationship" {...register('recipientRelationship' as any)}>
                {choose}
                {options('relationship', RELATIONSHIPS)}
              </Select>
              <FieldError message={err('recipientRelationship')} />
            </div>
          </>
        )}

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="recipientAge" required>{guardian ? t('patientIntake.fields.recipientAge') : t('patientIntake.fields.yourAge')}</Label>
            <Input id="recipientAge" type="number" inputMode="numeric" min={0} max={120} {...register('recipientAge' as any)} />
            <FieldError message={err('recipientAge')} />
          </div>
          <div>
            <Label htmlFor="recipientGender" required>{guardian ? t('patientIntake.fields.recipientGender') : t('patientIntake.fields.yourGender')}</Label>
            <Select id="recipientGender" {...register('recipientGender' as any)}>
              {choose}
              {options('gender', GENDERS)}
            </Select>
            <FieldError message={err('recipientGender')} />
          </div>
        </div>
      </Section>

      <Section title={t('patientIntake.sections.contact')}>
        <div>
          <Label htmlFor="alternatePhone">{t('patientIntake.fields.alternatePhone')}</Label>
          <Input id="alternatePhone" type="tel" inputMode="tel" {...register('alternatePhone' as any)} />
          <FieldError message={err('alternatePhone')} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="preferredContactMethod" required>{t('patientIntake.fields.contactMethod')}</Label>
            <Select id="preferredContactMethod" {...register('preferredContactMethod' as any)}>
              {choose}
              {options('contactMethod', contactMethods)}
            </Select>
            <FieldError message={err('preferredContactMethod')} />
          </div>
          <div>
            <Label htmlFor="preferredContactTime" required>{t('patientIntake.fields.contactTime')}</Label>
            <Select id="preferredContactTime" {...register('preferredContactTime' as any)}>
              {options('contactTime', CONTACT_TIMES)}
            </Select>
            <FieldError message={err('preferredContactTime')} />
          </div>
        </div>
      </Section>

      <Section title={t('patientIntake.sections.location')}>
        {locationsUnavailable && (
          <p role="alert" className="rounded border border-danger/30 bg-danger/5 px-3 py-2 text-xs text-danger">
            {t('common.locationsUnavailable')}
          </p>
        )}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="districtId" required>{t('patientIntake.fields.district')}</Label>
            <Controller
              name={'districtId' as any}
              control={control}
              render={({ field }) => (
                <Select
                  id="districtId"
                  ref={field.ref}
                  value={field.value ?? ''}
                  onChange={(e) => {
                    field.onChange(e);
                    // A city belongs to one district; drop the old pick when the district changes.
                    if (e.target.value !== field.value) setValue('cityId' as any, '' as any);
                  }}
                >
                  {choose}
                  {districts.map((d) => (
                    <option key={d.id} value={d.id}>{d.name}</option>
                  ))}
                </Select>
              )}
            />
            <FieldError message={err('districtId')} />
          </div>
          <div>
            <Label htmlFor="cityId" required>{t('patientIntake.fields.city')}</Label>
            <Controller
              name={'cityId' as any}
              control={control}
              render={({ field }) => (
                <Select id="cityId" ref={field.ref} value={field.value ?? ''} onChange={field.onChange} disabled={!selectedDistrictId}>
                  {choose}
                  {cities.map((c) => (
                    <option key={c.id} value={c.id}>{c.subName ? `${c.name} - ${c.subName}` : c.name}</option>
                  ))}
                </Select>
              )}
            />
            <FieldError message={err('cityId')} />
            {selectedCity?.postcode && <p className="mt-1 text-xs text-ink/60" aria-live="polite">{selectedCity.postcode}</p>}
          </div>
        </div>
        <div>
          <Label htmlFor="careAddress">{t('patientIntake.fields.careAddress')}</Label>
          <Input id="careAddress" {...register('careAddress' as any)} />
          <FieldError message={err('careAddress')} />
        </div>
      </Section>

      <Section title={t('patientIntake.sections.care')}>
        <div>
          <Label htmlFor="careNeeds" required>{t('patientIntake.fields.careNeeds')}</Label>
          <Textarea id="careNeeds" rows={3} placeholder={t('patientIntake.careNeedsPlaceholder')} {...register('careNeeds' as any)} />
          <FieldError message={err('careNeeds')} />
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="careSchedule" required>{t('patientIntake.fields.careSchedule')}</Label>
            <Select id="careSchedule" {...register('careSchedule' as any)}>
              {choose}
              {options('careSchedule', CARE_SCHEDULES)}
            </Select>
            <FieldError message={err('careSchedule')} />
          </div>
          <div>
            <Label htmlFor="careStart" required>{t('patientIntake.fields.careStart')}</Label>
            <Select id="careStart" {...register('careStart' as any)}>
              {choose}
              {options('careStart', CARE_STARTS)}
            </Select>
            <FieldError message={err('careStart')} />
          </div>
        </div>
        <div>
          <Label htmlFor="preferredCaregiverGender">{t('patientIntake.fields.caregiverGender')}</Label>
          <Select id="preferredCaregiverGender" {...register('preferredCaregiverGender' as any)}>
            {options('caregiverGender', CAREGIVER_GENDER_PREFERENCES)}
          </Select>
          <FieldError message={err('preferredCaregiverGender')} />
        </div>
      </Section>
    </div>
  );
}
