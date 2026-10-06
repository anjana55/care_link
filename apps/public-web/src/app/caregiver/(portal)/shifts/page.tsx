'use client';

import { useEffect, useState } from 'react';
import { useTranslation } from '@/lib/i18n';
import { ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Input, Label, Select, FieldError } from '@/components/ui/input';
import { useAvailability, useSaveAvailability } from '@/lib/hooks/use-caregiver-portal';
import { SHIFT_PREFERENCES, type Availability, type ShiftPreference } from '@/lib/api/portal-types';

interface Form {
  dayDuty: boolean;
  nightDuty: boolean;
  liveIn24h: boolean;
  preferredShift: ShiftPreference;
  availableFrom: string;
  expectedDailyRate: string;
  expectedMonthlyRate: string;
  expectedLeaveDays: string;
  preferredLeavePattern: string;
}

const EMPTY: Form = {
  dayDuty: false,
  nightDuty: false,
  liveIn24h: false,
  preferredShift: 'FLEXIBLE',
  availableFrom: '',
  expectedDailyRate: '',
  expectedMonthlyRate: '',
  expectedLeaveDays: '',
  preferredLeavePattern: '',
};

const fromRecord = (a: Availability | null | undefined): Form =>
  a
    ? {
        dayDuty: a.dayDuty,
        nightDuty: a.nightDuty,
        liveIn24h: a.liveIn24h,
        preferredShift: a.preferredShift,
        availableFrom: a.availableFrom ? String(a.availableFrom).slice(0, 10) : '',
        expectedDailyRate: a.expectedDailyRate ?? '',
        expectedMonthlyRate: a.expectedMonthlyRate ?? '',
        expectedLeaveDays: a.expectedLeaveDays === null || a.expectedLeaveDays === undefined ? '' : String(a.expectedLeaveDays),
        preferredLeavePattern: a.preferredLeavePattern ?? '',
      }
    : EMPTY;

const MONEY = /^\d{1,8}(\.\d{1,2})?$/;

/**
 * Which shifts the caregiver can work, and on what terms.
 *
 * These are the same flags the public caregiver search filters on, so this page
 * is what decides which families can find them for day, night and live-in work.
 * Money and leave fields are optional and sent only when filled: the API takes
 * numeric strings and an empty string is not one.
 */
export default function CaregiverShiftsPage() {
  const { t } = useTranslation();
  const { data, isLoading, isError } = useAvailability();
  const save = useSaveAvailability();
  const [form, setForm] = useState<Form>(EMPTY);
  const [errors, setErrors] = useState<Partial<Record<keyof Form, string>>>({});
  const [saved, setSaved] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);

  useEffect(() => {
    if (data !== undefined) setForm(fromRecord(data));
  }, [data]);

  const set = <K extends keyof Form>(key: K, value: Form[K]) => {
    setSaved(false);
    setErrors((e) => ({ ...e, [key]: undefined }));
    setForm((f) => ({ ...f, [key]: value }));
  };

  const validate = () => {
    const next: Partial<Record<keyof Form, string>> = {};
    if (form.expectedDailyRate && !MONEY.test(form.expectedDailyRate)) next.expectedDailyRate = t('portal.shifts.invalidAmount');
    if (form.expectedMonthlyRate && !MONEY.test(form.expectedMonthlyRate)) next.expectedMonthlyRate = t('portal.shifts.invalidAmount');
    if (form.expectedLeaveDays && !/^\d{1,2}$/.test(form.expectedLeaveDays)) next.expectedLeaveDays = t('portal.shifts.invalidDays');
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setServerError(null);
    if (!validate()) return;
    const body: Record<string, unknown> = {
      dayDuty: form.dayDuty,
      nightDuty: form.nightDuty,
      liveIn24h: form.liveIn24h,
      preferredShift: form.preferredShift,
    };
    if (form.availableFrom) body.availableFrom = form.availableFrom;
    if (form.expectedDailyRate) body.expectedDailyRate = form.expectedDailyRate;
    if (form.expectedMonthlyRate) body.expectedMonthlyRate = form.expectedMonthlyRate;
    if (form.expectedLeaveDays) body.expectedLeaveDays = Number(form.expectedLeaveDays);
    if (form.preferredLeavePattern.trim()) body.preferredLeavePattern = form.preferredLeavePattern.trim();

    save.mutate(body, {
      onSuccess: () => setSaved(true),
      onError: (err) => setServerError(err instanceof ApiError ? err.message : t('portal.saveError')),
    });
  };

  if (isLoading) return <p className="text-sm text-ink/60">{t('common.loading')}</p>;
  if (isError) return <p role="alert" className="text-sm text-danger">{t('portal.loadError')}</p>;

  const noShift = !form.dayDuty && !form.nightDuty && !form.liveIn24h;

  return (
    <form onSubmit={onSubmit} className="space-y-5" noValidate>
      <div>
        <h1 className="text-xl font-semibold text-ink">{t('portal.shifts.title')}</h1>
        <p className="mt-1 text-sm text-ink/60">{t('portal.shifts.subtitle')}</p>
      </div>

      <fieldset className="rounded-lg border border-border bg-white p-5">
        <legend className="px-1 text-sm font-semibold text-ink">{t('portal.shifts.canWork')}</legend>
        <div className="space-y-3">
          {(['dayDuty', 'nightDuty', 'liveIn24h'] as const).map((key) => (
            <label key={key} className="flex items-start gap-3 text-sm">
              <input
                type="checkbox"
                checked={form[key]}
                onChange={(e) => set(key, e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border text-brand focus:ring-brand"
              />
              <span>
                <span className="font-medium text-ink">{t(`portal.shifts.${key}`)}</span>
                <span className="block text-xs text-ink/50">{t(`portal.shifts.${key}Hint`)}</span>
              </span>
            </label>
          ))}
        </div>
        {noShift && <p role="status" className="mt-3 text-xs text-amber-700">{t('portal.shifts.noneSelected')}</p>}

        <div className="mt-5 grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="preferredShift">{t('portal.shifts.preferred')}</Label>
            <Select id="preferredShift" value={form.preferredShift} onChange={(e) => set('preferredShift', e.target.value as ShiftPreference)}>
              {SHIFT_PREFERENCES.map((p) => (
                <option key={p} value={p}>{t(`portal.shifts.preference.${p}`)}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label htmlFor="availableFrom">{t('portal.shifts.availableFrom')}</Label>
            <Input id="availableFrom" type="date" value={form.availableFrom} onChange={(e) => set('availableFrom', e.target.value)} />
          </div>
        </div>
      </fieldset>

      <fieldset className="rounded-lg border border-border bg-white p-5">
        <legend className="px-1 text-sm font-semibold text-ink">{t('portal.shifts.terms')}</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <Label htmlFor="expectedDailyRate">{t('portal.shifts.dailyRate')}</Label>
            <Input id="expectedDailyRate" inputMode="decimal" value={form.expectedDailyRate} onChange={(e) => set('expectedDailyRate', e.target.value)} />
            <FieldError message={errors.expectedDailyRate} />
          </div>
          <div>
            <Label htmlFor="expectedMonthlyRate">{t('portal.shifts.monthlyRate')}</Label>
            <Input id="expectedMonthlyRate" inputMode="decimal" value={form.expectedMonthlyRate} onChange={(e) => set('expectedMonthlyRate', e.target.value)} />
            <FieldError message={errors.expectedMonthlyRate} />
          </div>
          <div>
            <Label htmlFor="expectedLeaveDays">{t('portal.shifts.leaveDays')}</Label>
            <Input id="expectedLeaveDays" inputMode="numeric" value={form.expectedLeaveDays} onChange={(e) => set('expectedLeaveDays', e.target.value)} />
            <FieldError message={errors.expectedLeaveDays} />
          </div>
          <div>
            <Label htmlFor="preferredLeavePattern">{t('portal.shifts.leavePattern')}</Label>
            <Input id="preferredLeavePattern" value={form.preferredLeavePattern} onChange={(e) => set('preferredLeavePattern', e.target.value)} />
          </div>
        </div>
        <p className="mt-3 text-xs text-ink/50">{t('portal.shifts.termsHint')}</p>
      </fieldset>

      {serverError && <p role="alert" className="text-sm text-danger">{serverError}</p>}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={save.isPending}>{save.isPending ? t('common.loading') : t('common.save')}</Button>
        {saved && <span role="status" className="text-sm text-brand-dark">{t('portal.saved')}</span>}
      </div>
    </form>
  );
}
