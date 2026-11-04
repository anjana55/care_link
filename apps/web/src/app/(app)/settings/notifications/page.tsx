'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { NOTIFICATION_SETTINGS_LIMITS, type NotificationSettings } from '@care-platform/shared';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { useNotificationSettings, useUpdateNotificationSettings } from '@/lib/hooks/use-announcements';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';

type Draft = { remindersEnabled: boolean; quietStartHour: string; quietEndHour: string; dailyReminderCap: string; retentionDays: string };
const toDraft = (s: NotificationSettings): Draft => ({
  remindersEnabled: s.remindersEnabled,
  quietStartHour: String(s.quietStartHour),
  quietEndHour: String(s.quietEndHour),
  dailyReminderCap: String(s.dailyReminderCap),
  retentionDays: String(s.retentionDays),
});
const inRange = (v: string, { min, max }: { min: number; max: number }) => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max;
const HOURS = Array.from({ length: 24 }, (_, h) => h);

/**
 * Settings > Notifications (admin): reminders on or off, the quiet hours when
 * nobody is sent a reminder, how many reminders a person may get in a day
 * (more are combined into one), and how long the bell keeps notifications.
 */
export default function NotificationSettingsPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { data: settings, isLoading } = useNotificationSettings(user?.role === 'ADMIN');
  const save = useUpdateNotificationSettings();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    if (authLoading) return;
    if (user && user.role !== 'ADMIN') router.replace('/dashboard');
  }, [authLoading, user, router]);
  useEffect(() => {
    if (settings && !draft) setDraft(toDraft(settings));
  }, [settings, draft]);

  if (authLoading || !user || user.role !== 'ADMIN' || isLoading || !draft) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;
  }

  const bad = {
    dailyReminderCap: !inRange(draft.dailyReminderCap, NOTIFICATION_SETTINGS_LIMITS.dailyReminderCap),
    retentionDays: !inRange(draft.retentionDays, NOTIFICATION_SETTINGS_LIMITS.retentionDays),
  };
  const change = (patch: Partial<Draft>) => {
    setSaved(false);
    setError(null);
    setDraft({ ...draft, ...patch });
  };
  const submit = () =>
    save.mutate(
      {
        remindersEnabled: draft.remindersEnabled,
        quietStartHour: Number(draft.quietStartHour),
        quietEndHour: Number(draft.quietEndHour),
        dailyReminderCap: Number(draft.dailyReminderCap),
        retentionDays: Number(draft.retentionDays),
      },
      {
        onSuccess: (data) => {
          setDraft(toDraft(data));
          setSaved(true);
          setTimeout(() => setSaved(false), 3000);
        },
        onError: (err) => setError(err instanceof ApiError && err.message ? err.message : t('notificationsAdmin.saveError')),
      },
    );

  const hour = (key: 'quietStartHour' | 'quietEndHour', label: string) => (
    <div>
      <Label htmlFor={key}>{label}</Label>
      <Select id={key} value={draft[key]} onChange={(e) => change({ [key]: e.target.value } as Partial<Draft>)} className="max-w-[8rem]">
        {HOURS.map((h) => (
          <option key={h} value={String(h)}>
            {String(h).padStart(2, '0')}:00
          </option>
        ))}
      </Select>
    </div>
  );
  const number = (key: 'dailyReminderCap' | 'retentionDays', label: string, hint: string) => (
    <div>
      <Label htmlFor={key}>{label}</Label>
      <Input id={key} inputMode="numeric" value={draft[key]} aria-invalid={bad[key]} aria-describedby={`${key}-hint`} onChange={(e) => change({ [key]: e.target.value } as Partial<Draft>)} className="max-w-[8rem]" />
      <p id={`${key}-hint`} className={`mt-1 text-xs ${bad[key] ? 'text-danger' : 'text-ink/50'}`}>
        {hint}
      </p>
    </div>
  );

  return (
    <div className="max-w-3xl">
      <h2 className="mb-1 text-lg font-semibold text-ink">{t('notificationsAdmin.title')}</h2>
      <p className="mb-4 text-sm text-ink/60">{t('notificationsAdmin.subtitle')}</p>
      <Card>
        <CardContent className="space-y-5 pt-5">
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={draft.remindersEnabled} onChange={(e) => change({ remindersEnabled: e.target.checked })} />
            <span>
              <span className="block text-sm font-medium text-ink">{t('notificationsAdmin.remindersEnabled')}</span>
              <span className="block text-xs text-ink/50">{t('notificationsAdmin.remindersEnabledHint')}</span>
            </span>
          </label>
          <fieldset>
            <legend className="mb-1 text-sm font-medium text-ink">{t('notificationsAdmin.quietHours')}</legend>
            <p className="mb-2 text-xs text-ink/50">{t('notificationsAdmin.quietHoursHint')}</p>
            <div className="flex flex-wrap gap-4">
              {hour('quietStartHour', t('notificationsAdmin.from'))}
              {hour('quietEndHour', t('notificationsAdmin.until'))}
            </div>
          </fieldset>
          {number('dailyReminderCap', t('notificationsAdmin.dailyCap'), t('notificationsAdmin.dailyCapHint'))}
          {number('retentionDays', t('notificationsAdmin.retention'), t('notificationsAdmin.retentionHint'))}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex items-center gap-3">
            <Button onClick={submit} disabled={save.isPending || bad.dailyReminderCap || bad.retentionDays}>
              {save.isPending ? t('common.loading') : t('common.save')}
            </Button>
            {saved && (
              <span role="status" className="text-sm text-brand-dark">
                {t('notificationsAdmin.saved')}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
