'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Availability } from '@/lib/api/types';
import { Input, Label, Select, FieldError, RequiredLegend } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n/provider';
import { careTypeValues, type CareType } from '@care-platform/shared';

const DEFAULT_FORM = {
  // All on, like the database default: a caregiver shows for every type of
  // care until someone narrows it down.
  careTypes: [...careTypeValues] as CareType[],
  dayDuty: false,
  nightDuty: false,
  liveIn24h: false,
  availableFrom: '',
  preferredShift: 'FLEXIBLE',
  expectedDailyRate: '',
  expectedMonthlyRate: '',
  expectedLeaveDays: '',
  preferredLeavePattern: '',
};

export function AvailabilityStep({ caregiverId, onNext, onBack }: { caregiverId: string; onNext: () => void; onBack: () => void }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const [form, setForm] = useState(DEFAULT_FORM);

  const { data } = useQuery({
    queryKey: ['availability', caregiverId],
    queryFn: () => api.get<Availability | null>(`/caregivers/${caregiverId}/availability`),
    enabled: Boolean(caregiverId),
    placeholderData: null,
  });

  useEffect(() => {
    if (data) {
      setForm({
        careTypes: data.careTypes ?? [...careTypeValues],
        dayDuty: data.dayDuty,
        nightDuty: data.nightDuty,
        liveIn24h: data.liveIn24h,
        availableFrom: data.availableFrom?.slice(0, 10) ?? '',
        preferredShift: data.preferredShift,
        expectedDailyRate: data.expectedDailyRate ?? '',
        expectedMonthlyRate: data.expectedMonthlyRate ?? '',
        expectedLeaveDays: data.expectedLeaveDays?.toString() ?? '',
        preferredLeavePattern: data.preferredLeavePattern ?? '',
      });
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: () =>
      // Blank optional fields are left out rather than sent as '': the DTO's
      // @IsOptional() skips only null/undefined, so an empty string would fail
      // @IsNumberString() / @IsDateString() and the whole save would 400.
      api.put(`/caregivers/${caregiverId}/availability`, {
        careTypes: form.careTypes,
        dayDuty: form.dayDuty,
        nightDuty: form.nightDuty,
        liveIn24h: form.liveIn24h,
        preferredShift: form.preferredShift,
        availableFrom: form.availableFrom,
        expectedDailyRate: form.expectedDailyRate || undefined,
        expectedMonthlyRate: form.expectedMonthlyRate || undefined,
        expectedLeaveDays: form.expectedLeaveDays ? Number(form.expectedLeaveDays) : undefined,
        preferredLeavePattern: form.preferredLeavePattern.trim() || undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['availability', caregiverId] });
      onNext();
    },
  });

  // The rules this step enforces.
  //
  // Every field in UpsertAvailabilityDto is @IsOptional() and the database
  // defaults preferred_shift to FLEXIBLE, so the API will happily store a
  // caregiver who is available for nothing at all. That is not a harmless
  // default: ranking.service.ts scores a shift match only when
  // dayDuty/nightDuty/liveIn24h is set, so a caregiver with all three
  // unticked can never match a DAY, NIGHT or TWENTY_FOUR_HOUR_LIVE_IN search
  // and is effectively invisible to the public finder. One tick is the
  // minimum that makes the record mean anything.
  //
  // Staff registration also needs a start date and a rate (daily or monthly -
  // either is enough), which staff need when pricing bookings. These are
  // enforced here only - the caregiver portal shares the endpoint and
  // deliberately lets caregivers leave pay blank.
  //
  // At least one care type: public search filters on it, so a caregiver with
  // none ticked could never be found.
  const [submitted, setSubmitted] = useState(false);
  const errors = {
    careTypes: form.careTypes.length === 0 ? t('caregivers.careTypes.required') : undefined,
    dutyType: !form.dayDuty && !form.nightDuty && !form.liveIn24h ? t('caregivers.me.availability.dutyTypeRequired') : undefined,
    availableFrom: !form.availableFrom ? t('caregivers.me.availability.availableFromRequired') : undefined,
    rate: !form.expectedDailyRate && !form.expectedMonthlyRate ? t('caregivers.me.availability.rateRequired') : undefined,
  };
  // Errors appear only after the first Next press, then track the form live so
  // fixing a field clears its message straight away.
  const shown = (key: keyof typeof errors) => (submitted ? errors[key] : undefined);
  const handleNext = () => {
    setSubmitted(true);
    if (Object.values(errors).some(Boolean)) return;
    saveMutation.mutate();
  };

  return (
    <div className="space-y-6">
      <RequiredLegend label={t('common.requiredField')} />

      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-ink">
          {t('caregivers.careTypes.label')}
          <span aria-hidden="true" className="ml-0.5 text-danger">
            *
          </span>
        </legend>
        <p className="mb-2 text-xs text-ink/50">{t('caregivers.careTypes.hint')}</p>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {careTypeValues.map((type) => (
            <label key={type} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={form.careTypes.includes(type)}
                onChange={(e) =>
                  setForm({
                    ...form,
                    careTypes: e.target.checked ? careTypeValues.filter((v) => v === type || form.careTypes.includes(v)) : form.careTypes.filter((v) => v !== type),
                  })
                }
                className="h-4 w-4 rounded border-border text-brand focus:ring-brand"
              />
              {t(`careTypes.${type}`)}
            </label>
          ))}
        </div>
        <FieldError message={shown('careTypes')} />
      </fieldset>

      {/* Marked on the group rather than on any single box: it is "at least
          one of these" that is required, and ticking a `*` onto all three
          would claim each is individually mandatory. The marker's colour and
          glyph are reused from <Label required> so the two read the same. */}
      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-ink">
          {t('caregivers.me.availability.dutyTypes')}
          <span aria-hidden="true" className="ml-0.5 text-danger">
            *
          </span>
        </legend>
        <div className="flex flex-wrap gap-6">
          {(['dayDuty', 'nightDuty', 'liveIn24h'] as const).map((key) => (
            <label key={key} className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                checked={form[key]}
                onChange={(e) => setForm({ ...form, [key]: e.target.checked })}
                className="h-4 w-4 rounded border-border text-brand focus:ring-brand"
              />
              {key === 'dayDuty' ? t('caregivers.me.availability.dayDuty') : key === 'nightDuty' ? t('caregivers.me.availability.nightDuty') : t('caregivers.me.availability.liveIn24h')}
            </label>
          ))}
        </div>
        <FieldError message={shown('dutyType')} />
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="availableFrom" required>
            {t('caregivers.me.availability.availableFrom')}
          </Label>
          <Input
            id="availableFrom"
            type="date"
            required
            aria-invalid={Boolean(shown('availableFrom'))}
            value={form.availableFrom}
            onChange={(e) => setForm({ ...form, availableFrom: e.target.value })}
          />
          <FieldError message={shown('availableFrom')} />
        </div>
        <div>
          <Label htmlFor="preferredShift">{t('caregivers.me.availability.preferredShift')}</Label>
          <Select id="preferredShift" value={form.preferredShift} onChange={(e) => setForm({ ...form, preferredShift: e.target.value })}>
            <option value="DAY">{t('caregivers.me.availability.day')}</option>
            <option value="NIGHT">{t('caregivers.me.availability.night')}</option>
            <option value="TWENTY_FOUR_HOUR_LIVE_IN">{t('caregivers.me.availability.twentyFourHourLiveIn')}</option>
            <option value="FLEXIBLE">{t('caregivers.me.availability.flexible')}</option>
          </Select>
        </div>
      </div>

      {/* Same treatment as duty types: one `*` on the group, because it is
          "daily or monthly" that is required, not both. */}
      <fieldset>
        <legend className="mb-1.5 block text-sm font-medium text-ink">
          {t('caregivers.me.availability.expectedRate')}
          <span aria-hidden="true" className="ml-0.5 text-danger">
            *
          </span>
        </legend>
        <p className="mb-2 text-xs text-ink/50">{t('caregivers.me.availability.rateHint')}</p>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="expectedDailyRate">{t('caregivers.me.availability.expectedDailyRate')}</Label>
            <Input
              id="expectedDailyRate"
              type="number"
              min={0}
              aria-invalid={Boolean(shown('rate'))}
              value={form.expectedDailyRate}
              onChange={(e) => setForm({ ...form, expectedDailyRate: e.target.value })}
            />
          </div>
          <div>
            <Label htmlFor="expectedMonthlyRate">{t('caregivers.me.availability.expectedMonthlyRate')}</Label>
            <Input
              id="expectedMonthlyRate"
              type="number"
              min={0}
              aria-invalid={Boolean(shown('rate'))}
              value={form.expectedMonthlyRate}
              onChange={(e) => setForm({ ...form, expectedMonthlyRate: e.target.value })}
            />
          </div>
        </div>
        <FieldError message={shown('rate')} />
      </fieldset>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label htmlFor="expectedLeaveDays">{t('caregivers.me.availability.expectedLeaveDays')}</Label>
          <Input id="expectedLeaveDays" type="number" min={0} value={form.expectedLeaveDays} onChange={(e) => setForm({ ...form, expectedLeaveDays: e.target.value })} />
        </div>
        <div>
          <Label htmlFor="preferredLeavePattern">{t('caregivers.me.availability.preferredLeavePattern')}</Label>
          <Input
            id="preferredLeavePattern"
            value={form.preferredLeavePattern}
            onChange={(e) => setForm({ ...form, preferredLeavePattern: e.target.value })}
            placeholder={t('caregivers.me.availability.placeholder')}
          />
        </div>
      </div>

      <div className="flex justify-between border-t border-border pt-4">
        <Button type="button" variant="secondary" onClick={onBack}>
          {t('caregivers.wizard.back')}
        </Button>
        <Button type="button" onClick={handleNext} disabled={saveMutation.isPending}>
          {t('caregivers.wizard.next')}
        </Button>
      </div>
    </div>
  );
}