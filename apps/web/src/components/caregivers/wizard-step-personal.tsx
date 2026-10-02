'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from '@/lib/i18n/provider';
import { useCreateCaregiver, useLocations } from '@/lib/hooks/use-caregivers';
import { Button } from '@/components/ui/button';
import { RequiredLegend } from '@/components/ui/input';
import { ApiError } from '@/lib/api/client';
import { useState } from 'react';
import { makePersonalInfoSchema, requiredFieldsOf, type PersonalInfoValues } from '@/lib/schemas/personal-info';
import { PersonalInfoFields } from './personal-info-fields';

export function PersonalInfoStep({ onCreated }: { onCreated: (caregiverId: string) => void }) {
  const { t } = useTranslation();
  const createCaregiver = useCreateCaregiver();
  const [serverError, setServerError] = useState<string | null>(null);
  // District and city are dropdowns populated from the locations table. Without
  // this the district select renders only its placeholder, so the field is
  // unanswerable and the form can't be submitted.
  const { data: locations, isError: locationsUnavailable } = useLocations();

  const personalInfoSchemaLocalized = makePersonalInfoSchema(t);
  const requiredFields = requiredFieldsOf(personalInfoSchemaLocalized);

  const {
    register,
    control,
    setValue,
    handleSubmit,
    formState: { errors },
  } = useForm<PersonalInfoValues>({ resolver: zodResolver(personalInfoSchemaLocalized) });

  const onSubmit = async (values: PersonalInfoValues) => {
    setServerError(null);
    try {
      const cleaned = Object.fromEntries(Object.entries(values).filter(([, v]) => v !== '' && v !== undefined));
      const result = await createCaregiver.mutateAsync(cleaned);
      onCreated(result.id);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : 'Could not save. Please try again.');
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <RequiredLegend label={t('common.requiredField')} />
      <PersonalInfoFields
        register={register}
        control={control}
        setValue={setValue}
        errors={errors}
        locations={locations ?? []}
        locationsUnavailable={locationsUnavailable}
        requiredFields={requiredFields}
      />

      {serverError && <p className="text-sm text-danger">{serverError}</p>}

      <div className="flex justify-end border-t border-border pt-4">
        <Button type="submit" disabled={createCaregiver.isPending}>
          {createCaregiver.isPending ? t('common.loading') : t('caregivers.wizard.next')}
        </Button>
      </div>
    </form>
  );
}