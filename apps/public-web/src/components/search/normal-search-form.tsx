'use client';

import { useMemo, useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { searchRequestSchema, type SearchRequest } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useMetaSkills, useMetaLanguages, useMetaLocations } from '@/lib/hooks/use-public-search';
import { cn } from '@/lib/utils';

interface NormalSearchFormProps {
  onSubmit: (request: SearchRequest) => void;
  initialValues?: SearchRequest;
}

/**
 * Only these two fields are mandatory. Zod reports them with a `required`
 * message, but zod's own messages are English-only, so they are mapped to
 * translated copy here rather than shown raw.
 */
const REQUIRED_FIELD_MESSAGE_KEYS: Record<string, string> = {
  'location.district': 'normalSearch.errors.districtRequired',
  desiredStartDate: 'normalSearch.errors.startDateRequired',
};

/**
 * Flattens react-hook-form's error tree into `path -> leaf` pairs. A leaf is
 * `{ type, message, ref }`; anything deeper is a nested group. The tree nests
 * for object fields (`{ location: { district } }`) and carries array indices
 * as `0`, `1`, ... so both shapes have to be walked to get at
 * `location.district`.
 */
function flattenFieldErrors(errors: unknown, prefix = ''): Record<string, unknown> {
  const flat: Record<string, unknown> = {};
  if (!errors || typeof errors !== 'object') return flat;

  for (const [key, value] of Object.entries(errors as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === 'object' && 'message' in (value as Record<string, unknown>)) {
      flat[path] = value;
    } else if (value && typeof value === 'object') {
      Object.assign(flat, flattenFieldErrors(value, path));
    }
  }
  return flat;
}

function ChipToggle({
  options,
  selected,
  onToggle,
}: {
  options: { id: string; label: string }[];
  selected: string[];
  onToggle: (id: string) => void;
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {options.map((opt) => {
        const active = selected.includes(opt.id);
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onToggle(opt.id)}
            aria-pressed={active}
            className={cn(
              'rounded-full border px-3 py-1.5 text-sm transition-colors',
              active ? 'border-brand bg-brand text-white' : 'border-border bg-white text-ink/70 hover:border-brand',
            )}
          >
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}

export function NormalSearchForm({ onSubmit, initialValues }: NormalSearchFormProps) {
  const { t } = useTranslation();
  const { data: skills = [] } = useMetaSkills();
  const { data: languages = [] } = useMetaLanguages();
  const { data: locations = [] } = useMetaLocations();
  const [conditionInput, setConditionInput] = useState('');

  const districts = useMemo(() => [...new Set(locations.map((l) => l.district))].sort(), [locations]);

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { errors },
  } = useForm<SearchRequest>({
    resolver: zodResolver(searchRequestSchema),
    defaultValues: initialValues ?? { page: 1, pageSize: 20 },
  });

  /**
   * Validation failures used to be dropped on the floor - `errors` was pulled
   * out of formState and never rendered, so a blocked submit looked identical
   * to a button that did nothing. Map each errored path to translated copy the
   * fields can look themselves up in.
   */
  const errorMessages = useMemo(() => {
    const map: Record<string, string> = {};
    for (const path of Object.keys(flattenFieldErrors(errors))) {
      const requiredKey = REQUIRED_FIELD_MESSAGE_KEYS[path];
      map[path] = requiredKey ? t(requiredKey) : t('normalSearch.errors.invalidValue');
    }
    return map;
  }, [errors, t]);

  const districtError = errorMessages['location.district'];
  const startDateError = errorMessages.desiredStartDate;

  const watchedDistrict = watch('location.district');
  const cities = useMemo(
    () => [...new Set(locations.filter((l) => !watchedDistrict || l.district === watchedDistrict).map((l) => l.city))].sort(),
    [locations, watchedDistrict],
  );

  const mandatorySkillIds = watch('mandatorySkillIds') ?? [];
  const optionalSkillIds = watch('optionalSkillIds') ?? [];
  const languageIds = watch('languageIds') ?? [];
  const medicalConditions = watch('patient.medicalConditions') ?? [];

  function toggleFromList(field: 'mandatorySkillIds' | 'optionalSkillIds' | 'languageIds', id: string) {
    const current = (watch(field) ?? []) as string[];
    setValue(field, current.includes(id) ? current.filter((x) => x !== id) : [...current, id]);
  }

  function addCondition(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key !== 'Enter' || !conditionInput.trim()) return;
    e.preventDefault();
    setValue('patient.medicalConditions', [...medicalConditions, conditionInput.trim()]);
    setConditionInput('');
  }

  function removeCondition(value: string) {
    setValue(
      'patient.medicalConditions',
      medicalConditions.filter((c) => c !== value),
    );
  }

  return (
    <form
      onSubmit={handleSubmit((values) => onSubmit({ ...values, page: 1 }))}
      className="space-y-6"
      aria-label={t('normalSearch.submit')}
    >
      {/* Patient */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink/80">{t('normalSearch.patientSection')}</legend>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <div>
            <label htmlFor="patient-age" className="mb-1 block text-xs font-medium text-ink/60">
              {t('normalSearch.age')}
            </label>
            <input
              id="patient-age"
              type="number"
              min={0}
              max={120}
              {...register('patient.age', { valueAsNumber: true })}
              className="w-full rounded-DEFAULT border border-border bg-white px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="patient-gender" className="mb-1 block text-xs font-medium text-ink/60">
              {t('normalSearch.gender')}
            </label>
            <select
              id="patient-gender"
              {...register('patient.gender')}
              className="w-full rounded-DEFAULT border border-border bg-white px-3 py-2 text-sm"
              defaultValue=""
            >
              <option value="">—</option>
              <option value="MALE">{t('normalSearch.genderMale')}</option>
              <option value="FEMALE">{t('normalSearch.genderFemale')}</option>
            </select>
          </div>
        </div>
        <div>
          <label htmlFor="medical-conditions" className="mb-1 block text-xs font-medium text-ink/60">
            {t('normalSearch.medicalConditions')}
          </label>
          <input
            id="medical-conditions"
            value={conditionInput}
            onChange={(e) => setConditionInput(e.target.value)}
            onKeyDown={addCondition}
            placeholder={t('normalSearch.medicalConditionsPlaceholder')}
            className="w-full rounded-DEFAULT border border-border bg-white px-3 py-2 text-sm"
          />
          {medicalConditions.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {medicalConditions.map((c) => (
                <span key={c} className="flex items-center gap-1 rounded-full bg-accent-light px-3 py-1 text-xs text-ink">
                  {c}
                  <button type="button" onClick={() => removeCondition(c)} aria-label={`Remove ${c}`} className="text-ink/50 hover:text-ink">
                    ×
                  </button>
                </span>
              ))}
            </div>
          )}
        </div>
      </fieldset>

      {/* Location */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink/80">{t('normalSearch.locationSection')}</legend>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="district" className="mb-1 block text-xs font-medium text-ink/60">
              {t('normalSearch.district')} <span aria-hidden="true" className="text-danger">*</span>
            </label>
            <select
              id="district"
              {...register('location.district')}
              // aria-required rather than `required`: the native attribute would
              // make the browser block submit with its own untranslated tooltip
              // before react-hook-form ever runs the resolver.
              aria-required="true"
              aria-invalid={districtError ? true : undefined}
              aria-describedby={districtError ? 'district-error' : undefined}
              className={cn(
                'w-full rounded-DEFAULT border bg-white px-3 py-2 text-sm',
                districtError ? 'border-danger' : 'border-border',
              )}
              defaultValue=""
            >
              <option value="">{t('normalSearch.anyDistrict')}</option>
              {districts.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
            {districtError && (
              <p id="district-error" role="alert" className="mt-1 text-xs text-danger">
                {districtError}
              </p>
            )}
          </div>
          <div>
            <label htmlFor="city" className="mb-1 block text-xs font-medium text-ink/60">
              {t('normalSearch.city')}
            </label>
            <select
              id="city"
              {...register('location.city')}
              className="w-full rounded-DEFAULT border border-border bg-white px-3 py-2 text-sm"
              defaultValue=""
            >
              <option value="">{t('normalSearch.anyCity')}</option>
              {cities.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
        </div>
      </fieldset>

      {/* Care requirements */}
      <fieldset className="space-y-4">
        <legend className="text-sm font-semibold text-ink/80">{t('normalSearch.careSection')}</legend>

        <div>
          <p className="mb-1 text-xs font-medium text-ink/60">{t('normalSearch.mandatorySkills')}</p>
          <ChipToggle
            options={skills.map((s) => ({ id: s.id, label: s.name }))}
            selected={mandatorySkillIds}
            onToggle={(id) => toggleFromList('mandatorySkillIds', id)}
          />
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-ink/60">{t('normalSearch.optionalSkills')}</p>
          <ChipToggle
            options={skills.map((s) => ({ id: s.id, label: s.name }))}
            selected={optionalSkillIds}
            onToggle={(id) => toggleFromList('optionalSkillIds', id)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="preferred-gender" className="mb-1 block text-xs font-medium text-ink/60">
              {t('normalSearch.preferredGender')}
            </label>
            <select
              id="preferred-gender"
              {...register('caregiverGenderPreference')}
              className="w-full rounded-DEFAULT border border-border bg-white px-3 py-2 text-sm"
              defaultValue="ANY"
            >
              <option value="ANY">{t('normalSearch.genderAny')}</option>
              <option value="FEMALE">{t('normalSearch.genderFemale')}</option>
              <option value="MALE">{t('normalSearch.genderMale')}</option>
            </select>
          </div>
          <div>
            <label htmlFor="shift" className="mb-1 block text-xs font-medium text-ink/60">
              {t('normalSearch.shift')}
            </label>
            <select
              id="shift"
              {...register('shift')}
              className="w-full rounded-DEFAULT border border-border bg-white px-3 py-2 text-sm"
              defaultValue=""
            >
              <option value="">—</option>
              <option value="DAY">{t('normalSearch.shiftDay')}</option>
              <option value="NIGHT">{t('normalSearch.shiftNight')}</option>
              <option value="TWENTY_FOUR_HOUR_LIVE_IN">{t('normalSearch.shiftLiveIn')}</option>
              <option value="FLEXIBLE">{t('normalSearch.shiftFlexible')}</option>
            </select>
          </div>
        </div>

        <div>
          <p className="mb-1 text-xs font-medium text-ink/60">{t('normalSearch.languages')}</p>
          <ChipToggle
            options={languages.map((l) => ({ id: l.id, label: l.name }))}
            selected={languageIds}
            onToggle={(id) => toggleFromList('languageIds', id)}
          />
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="start-date" className="mb-1 block text-xs font-medium text-ink/60">
              {t('normalSearch.startDate')} <span aria-hidden="true" className="text-danger">*</span>
            </label>
            <input
              id="start-date"
              type="date"
              {...register('desiredStartDate')}
              aria-required="true"
              aria-invalid={startDateError ? true : undefined}
              aria-describedby={startDateError ? 'start-date-hint start-date-error' : 'start-date-hint'}
              className={cn(
                'w-full rounded-DEFAULT border bg-white px-3 py-2 text-sm',
                startDateError ? 'border-danger' : 'border-border',
              )}
            />
            {startDateError && (
              <p id="start-date-error" role="alert" className="mt-1 text-xs text-danger">
                {startDateError}
              </p>
            )}
            <p id="start-date-hint" className="mt-1 text-xs text-ink/50">
              {t('normalSearch.startDateHint')}
            </p>
          </div>
          <div>
            <label htmlFor="min-experience" className="mb-1 block text-xs font-medium text-ink/60">
              {t('normalSearch.minimumExperience')}
            </label>
            <input
              id="min-experience"
              type="number"
              min={0}
              max={50}
              {...register('minimumExperienceYears', { valueAsNumber: true })}
              className="w-full rounded-DEFAULT border border-border bg-white px-3 py-2 text-sm"
            />
          </div>
        </div>
      </fieldset>

      {/* Budget */}
      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-ink/80">{t('normalSearch.budgetSection')}</legend>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="daily-budget" className="mb-1 block text-xs font-medium text-ink/60">
              {t('normalSearch.dailyBudget')}
            </label>
            <input
              id="daily-budget"
              type="number"
              min={0}
              {...register('budget.dailyRate', { valueAsNumber: true })}
              className="w-full rounded-DEFAULT border border-border bg-white px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label htmlFor="monthly-budget" className="mb-1 block text-xs font-medium text-ink/60">
              {t('normalSearch.monthlyBudget')}
            </label>
            <input
              id="monthly-budget"
              type="number"
              min={0}
              {...register('budget.monthlyRate', { valueAsNumber: true })}
              className="w-full rounded-DEFAULT border border-border bg-white px-3 py-2 text-sm"
            />
          </div>
        </div>
      </fieldset>

      <div className="flex flex-wrap gap-3 pt-2">
        <button type="submit" className="rounded-DEFAULT bg-brand px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark">
          {t('normalSearch.submit')}
        </button>
        <button
          type="button"
          onClick={() => reset({ page: 1, pageSize: 20 })}
          className="rounded-DEFAULT border border-border px-6 py-2.5 text-sm font-medium text-ink/70 hover:bg-paper"
        >
          {t('normalSearch.reset')}
        </button>
      </div>
    </form>
  );
}
