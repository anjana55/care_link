'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import type { Availability } from '@/lib/api/types';
import { Input, Label, Select } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n/provider';

const DEFAULT_FORM = {
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
      api.put(`/caregivers/${caregiverId}/availability`, {
        ...form,
        expectedLeaveDays: form.expectedLeaveDays ? Number(form.expectedLeaveDays) : undefined,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['availability', caregiverId] });
      onNext();
    },
  });

  return (
    <div className="space-y-6">
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

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
        <div>
          <Label>{t('caregivers.me.availability.preferredShift')}</Label>
          <Select value={form.preferredShift} onChange={(e) => setForm({ ...form, preferredShift: e.target.value })}>
            <option value="DAY">{t('caregivers.me.availability.day')}</option>
            <option value="NIGHT">{t('caregivers.me.availability.night')}</option>
            <option value="TWENTY_FOUR_HOUR_LIVE_IN">{t('caregivers.me.availability.twentyFourHourLiveIn')}</option>
            <option value="FLEXIBLE">{t('caregivers.me.availability.flexible')}</option>
          </Select>
        </div>
        <div>
          <Label>{t('caregivers.me.availability.availableFrom')}</Label>
          <Input type="date" value={form.availableFrom} onChange={(e) => setForm({ ...form, availableFrom: e.target.value })} />
        </div>
        <div>
          <Label>{t('caregivers.me.availability.expectedDailyRate')}</Label>
          <Input type="number" value={form.expectedDailyRate} onChange={(e) => setForm({ ...form, expectedDailyRate: e.target.value })} />
        </div>
        <div>
          <Label>{t('caregivers.me.availability.expectedMonthlyRate')}</Label>
          <Input type="number" value={form.expectedMonthlyRate} onChange={(e) => setForm({ ...form, expectedMonthlyRate: e.target.value })} />
        </div>
        <div>
          <Label>{t('caregivers.me.availability.expectedLeaveDays')}</Label>
          <Input type="number" value={form.expectedLeaveDays} onChange={(e) => setForm({ ...form, expectedLeaveDays: e.target.value })} />
        </div>
        <div>
          <Label>{t('caregivers.me.availability.preferredLeavePattern')}</Label>
          <Input
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
        <Button type="button" onClick={() => saveMutation.mutate()} disabled={saveMutation.isPending}>
          {t('caregivers.wizard.next')}
        </Button>
      </div>
    </div>
  );
}