import { useMemo, useState } from 'react';
import type { FieldErrors, UseFormRegister } from 'react-hook-form';
import { Input, Label, FieldError, Select, Textarea } from '@/components/ui/input';
import type { Location } from '@/lib/api/types';
import type { PersonalInfoValues } from '@/lib/schemas/personal-info';
import { useTranslation } from '@/lib/i18n/provider';

export function PersonalInfoFields<T extends PersonalInfoValues>({
  register,
  errors,
  locations,
}: {
  register: UseFormRegister<T>;
  errors: FieldErrors<T>;
  locations?: Location[];
}) {
  const { t } = useTranslation();

  const [selectedDistrict, setSelectedDistrict] = useState<string>('');

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
        <Label htmlFor="fullName">{t('personalInfo.fields.fullName')}</Label>
        <Input id="fullName" {...register('fullName' as any)} />
        <FieldError message={errors.fullName?.message as string | undefined} />
      </div>

      <div className="sm:col-span-2">
        <Label htmlFor="permanentAddress">{t('personalInfo.fields.permanentAddress')}</Label>
        <Textarea id="permanentAddress" rows={2} {...register('permanentAddress' as any)} />
        <FieldError message={errors.permanentAddress?.message as string | undefined} />
      </div>

      <div>
        <Label htmlFor="district">{t('personalInfo.fields.district')}</Label>
        <Select id="district" {...register('district' as any)} value={selectedDistrict} onChange={(e) => { setSelectedDistrict(e.target.value); }}>
          <option value="">{t('personalInfo.options.select')}</option>
          {districts.map((d) => (
            <option key={d} value={d}>{d}</option>
          ))}
        </Select>
        <FieldError message={errors.district?.message as string | undefined} />
      </div>

      <div>
        <Label htmlFor="city">{t('personalInfo.fields.city')}</Label>
        <Select id="city" {...register('city' as any)} disabled={!selectedDistrict}>
          <option value="">{t('personalInfo.options.select')}</option>
          {cities.map((c) => (
            <option key={c} value={c}>{c}</option>
          ))}
        </Select>
        <FieldError message={errors.city?.message as string | undefined} />
      </div>

      <div>
        <Label htmlFor="postalCode">{t('personalInfo.fields.postalCode')}</Label>
        <Input id="postalCode" type="text" {...register('postalCode' as any)} />
        <FieldError message={errors.postalCode?.message as string | undefined} />
      </div>

      <div>
        <Label htmlFor="nic">{t('personalInfo.fields.nic')}</Label>
        <Input id="nic" {...register('nic' as any)} />
      </div>
      <div>
        <Label htmlFor="passportNumber">{t('personalInfo.fields.passportNumber')}</Label>
        <Input id="passportNumber" {...register('passportNumber' as any)} />
      </div>

      <div>
        <Label htmlFor="dateOfBirth">{t('personalInfo.fields.dateOfBirth')}</Label>
        <Input id="dateOfBirth" type="date" {...register('dateOfBirth' as any)} />
        <FieldError message={errors.dateOfBirth?.message as string | undefined} />
      </div>
      <div>
        <Label htmlFor="gender">{t('personalInfo.fields.gender')}</Label>
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
        <Label htmlFor="civilStatus">{t('personalInfo.fields.civilStatus')}</Label>
        <Select id="civilStatus" {...register('civilStatus' as any)}>
          {civilStatusOptions.map(opt => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </Select>
        <FieldError message={errors.civilStatus?.message as string | undefined} />
      </div>
      <div />

      <div>
        <Label htmlFor="heightCm">{t('personalInfo.fields.heightCm')}</Label>
        <Input id="heightCm" type="number" {...register('heightCm' as any)} />
      </div>
      <div>
        <Label htmlFor="weightKg">{t('personalInfo.fields.weightKg')}</Label>
        <Input id="weightKg" type="number" {...register('weightKg' as any)} />
      </div>

      <div>
        <Label htmlFor="primaryPhone">{t('personalInfo.fields.primaryPhone')}</Label>
        <Input id="primaryPhone" {...register('primaryPhone' as any)} />
      </div>
      <div>
        <Label htmlFor="secondaryPhone">{t('personalInfo.fields.secondaryPhone')}</Label>
        <Input id="secondaryPhone" {...register('secondaryPhone' as any)} />
      </div>

      <div>
        <Label htmlFor="emergencyContactName">{t('personalInfo.fields.emergencyContactName')}</Label>
        <Input id="emergencyContactName" {...register('emergencyContactName' as any)} />
        <FieldError message={errors.emergencyContactName?.message as string | undefined} />
      </div>
      <div>
        <Label htmlFor="emergencyContactNumber">{t('personalInfo.fields.emergencyContactNumber')}</Label>
        <Input id="emergencyContactNumber" {...register('emergencyContactNumber' as any)} />
        <FieldError message={errors.emergencyContactNumber?.message as string | undefined} />
      </div>
      <div>
        <Label htmlFor="emergencyContactRelationship">{t('personalInfo.fields.emergencyContactRelationship')}</Label>
        <Input id="emergencyContactRelationship" {...register('emergencyContactRelationship' as any)} />
        <FieldError message={errors.emergencyContactRelationship?.message as string | undefined} />
      </div>
      <div />

      <div>
        <Label htmlFor="policeDivision">{t('personalInfo.fields.policeDivision')}</Label>
        <Input id="policeDivision" {...register('policeDivision' as any)} />
      </div>
      <div>
        <Label htmlFor="policeStation">{t('personalInfo.fields.policeStation')}</Label>
        <Input id="policeStation" {...register('policeStation' as any)} />
      </div>
    </div>
  );
}