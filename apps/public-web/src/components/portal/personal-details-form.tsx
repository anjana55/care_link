'use client';

import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useTranslation } from '@/lib/i18n';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { PersonalInfoFields } from '@/components/caregivers/personal-info-fields';
import { makePersonalInfoSchema, requiredFieldsOf, UNSET_ID } from '@/lib/schemas/personal-info';
import { useLocationTree } from '@/lib/hooks/use-public-search';
import { useUpdateProfile } from '@/lib/hooks/use-caregiver-portal';
import type { OwnCaregiver } from '@/lib/api/portal-types';

/**
 * Fields that say *who* the caregiver is. The API lets them be corrected only
 * while the registration is still being assembled; once staff have started
 * checking documents against them, a self-service change would quietly
 * invalidate that check. Keep this list and the statuses in step with
 * IDENTITY_FIELDS / IDENTITY_EDITABLE_STATUSES in the API's caregivers service.
 */
const IDENTITY = ['fullName', 'dateOfBirth', 'gender', 'nic', 'passportNumber'] as const;
const IDENTITY_EDITABLE = new Set(['DRAFT', 'REGISTERED', 'DOCUMENTS_PENDING']);

const text = (v: string | null | undefined) => v ?? '';
const num = (v: string | number | null | undefined) => (v === null || v === undefined || v === '' ? ('' as unknown as number) : Number(v));

export function PersonalDetailsForm({ caregiver }: { caregiver: OwnCaregiver }) {
  const { t, locale } = useTranslation();
  const { data: locationTree, isError: locationsUnavailable } = useLocationTree(locale);
  const update = useUpdateProfile();
  const [saved, setSaved] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  const locked = !IDENTITY_EDITABLE.has(caregiver.status);
  // The login number is not editable here (changing it needs a verification
  // step), and a locked identity is shown, not edited.
  const hidden = useMemo(() => new Set<string>(['primaryPhone', ...(locked ? IDENTITY : [])]), [locked]);

  const objectSchema = makePersonalInfoSchema(t);
  const schema = useMemo(
    () => objectSchema.omit(Object.fromEntries([...hidden].map((k) => [k, true])) as never),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hidden, locale],
  );
  const requiredFields = requiredFieldsOf(schema as never);

  const {
    register,
    control,
    setValue,
    handleSubmit,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<any>({
    resolver: zodResolver(schema as never),
    defaultValues: {
      fullName: caregiver.fullName,
      permanentAddress: caregiver.permanentAddress,
      nic: text(caregiver.nic),
      passportNumber: text(caregiver.passportNumber),
      dateOfBirth: String(caregiver.dateOfBirth).slice(0, 10),
      gender: caregiver.gender,
      civilStatus: caregiver.civilStatus,
      heightIn: caregiver.heightIn === null ? '' : Number(caregiver.heightIn),
      weightKg: caregiver.weightKg === null ? '' : Number(caregiver.weightKg),
      secondaryPhone: text(caregiver.secondaryPhone),
      emergencyContactName: caregiver.emergencyContactName,
      emergencyContactNumber: caregiver.emergencyContactNumber,
      emergencyContactRelationship: caregiver.emergencyContactRelationship,
      policeDivision: text(caregiver.policeDivision),
      policeStation: text(caregiver.policeStation),
      districtId: caregiver.districtId ?? UNSET_ID,
      cityId: caregiver.cityId ?? UNSET_ID,
    },
  });

  const onSubmit = async (values: Record<string, unknown>) => {
    setSaved(false);
    setServerError(null);
    // Optional numbers coerce a blank to 0, which is "not given", not a height of 0.
    const body = { ...values };
    for (const k of ['heightIn', 'weightKg']) if (!body[k]) delete body[k];
    try {
      await update.mutateAsync(body);
      setSaved(true);
    } catch (err) {
      setServerError(err instanceof ApiError ? err.message : t('portal.saveError'));
    }
  };

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="rounded-lg border border-border bg-white p-5" noValidate>
      <h2 className="text-sm font-semibold text-ink">{t('portal.profile.personal')}</h2>

      <dl className="mb-4 mt-3 grid gap-3 rounded border border-border bg-paper p-3 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-xs text-ink/50">{t('portal.profile.loginPhone')}</dt>
          <dd className="text-ink">{caregiver.primaryPhone}</dd>
          <dd className="mt-0.5 text-xs text-ink/50">{t('portal.profile.loginPhoneHint')}</dd>
        </div>
        {locked && (
          <>
            <div>
              <dt className="text-xs text-ink/50">{t('personalInfo.fields.fullName')}</dt>
              <dd className="text-ink">{caregiver.fullName}</dd>
            </div>
            <div>
              <dt className="text-xs text-ink/50">{t('personalInfo.fields.dateOfBirth')}</dt>
              <dd className="text-ink">{String(caregiver.dateOfBirth).slice(0, 10)}</dd>
            </div>
            {caregiver.nic && (
              <div>
                <dt className="text-xs text-ink/50">{t('personalInfo.fields.nic')}</dt>
                <dd className="text-ink">{caregiver.nic}</dd>
              </div>
            )}
          </>
        )}
      </dl>
      {locked && <p className="mb-4 text-xs text-ink/60">{t('portal.profile.identityLocked')}</p>}

      <PersonalInfoFields
        register={register as any}
        control={control as any}
        setValue={setValue as any}
        errors={errors as any}
        locationTree={locationTree ?? []}
        locationsUnavailable={locationsUnavailable}
        requiredFields={requiredFields}
        omitFields={hidden}
      />

      {serverError && <p role="alert" className="mt-4 text-sm text-danger">{serverError}</p>}
      <div className="mt-5 flex items-center gap-3 border-t border-border pt-4">
        <Button type="submit" disabled={isSubmitting || !isDirty}>
          {isSubmitting ? t('common.loading') : t('common.save')}
        </Button>
        {saved && <span role="status" className="text-sm text-brand-dark">{t('portal.saved')}</span>}
      </div>
    </form>
  );
}
