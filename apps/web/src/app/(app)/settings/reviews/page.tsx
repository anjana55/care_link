'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { REVIEW_SETTINGS_LIMITS, type ReviewSettings } from '@care-platform/shared';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { useReviewSettings, useUpdateReviewSettings } from '@/lib/hooks/use-reviews';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';

type Draft = { enabled: boolean; minRatingsToShow: string; windowDays: string };
const toDraft = (s: ReviewSettings): Draft => ({ enabled: s.enabled, minRatingsToShow: String(s.minRatingsToShow), windowDays: String(s.windowDays) });
const inRange = (v: string, { min, max }: { min: number; max: number }) => /^\d+$/.test(v) && Number(v) >= min && Number(v) <= max;

/**
 * Settings > Reviews (admin): ratings on or off, how many ratings a caregiver
 * needs before the public sees their average, and how long after the last
 * shift a client can rate.
 */
export default function ReviewSettingsPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { data: settings, isLoading } = useReviewSettings();
  const save = useUpdateReviewSettings();
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

  if (authLoading || !user || user.role !== 'ADMIN' || isLoading || !draft || !settings) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;
  }

  const bad = {
    minRatingsToShow: !inRange(draft.minRatingsToShow, REVIEW_SETTINGS_LIMITS.minRatingsToShow),
    windowDays: !inRange(draft.windowDays, REVIEW_SETTINGS_LIMITS.windowDays),
  };
  const change = (patch: Partial<Draft>) => {
    setSaved(false);
    setError(null);
    setDraft({ ...draft, ...patch });
  };
  const submit = () =>
    save.mutate(
      { enabled: draft.enabled, minRatingsToShow: Number(draft.minRatingsToShow), windowDays: Number(draft.windowDays) },
      {
        onSuccess: (data) => {
          setDraft(toDraft(data));
          setSaved(true);
          setTimeout(() => setSaved(false), 3000);
        },
        onError: (err) => setError(err instanceof ApiError && err.message ? err.message : t('reviews.settings.saveError')),
      },
    );

  const number = (key: 'minRatingsToShow' | 'windowDays', label: string, hint: string) => (
    <div>
      <Label htmlFor={key}>{label}</Label>
      <Input
        id={key}
        inputMode="numeric"
        value={draft[key]}
        aria-invalid={bad[key]}
        aria-describedby={`${key}-hint`}
        onChange={(e) => change({ [key]: e.target.value } as Partial<Draft>)}
        className="max-w-[8rem]"
      />
      <p id={`${key}-hint`} className={`mt-1 text-xs ${bad[key] ? 'text-danger' : 'text-ink/50'}`}>
        {hint}
      </p>
    </div>
  );

  return (
    <div className="max-w-3xl">
      <h2 className="mb-1 text-lg font-semibold text-ink">{t('reviews.settings.title')}</h2>
      <p className="mb-4 text-sm text-ink/60">{t('reviews.settings.subtitle')}</p>
      <Card>
        <CardContent className="space-y-5 pt-5">
          <label className="flex items-start gap-3">
            <input type="checkbox" className="mt-1 h-4 w-4" checked={draft.enabled} onChange={(e) => change({ enabled: e.target.checked })} />
            <span>
              <span className="block text-sm font-medium text-ink">{t('reviews.settings.enabled')}</span>
              <span className="block text-xs text-ink/50">{t('reviews.settings.enabledHint')}</span>
            </span>
          </label>
          {number('minRatingsToShow', t('reviews.settings.minRatings'), t('reviews.settings.minRatingsHint'))}
          {number('windowDays', t('reviews.settings.windowDays'), t('reviews.settings.windowHint'))}
          {error && (
            <p role="alert" className="text-sm text-danger">
              {error}
            </p>
          )}
          <div className="flex items-center gap-3">
            <Button onClick={submit} disabled={save.isPending || bad.minRatingsToShow || bad.windowDays}>
              {save.isPending ? t('common.loading') : t('common.save')}
            </Button>
            {saved && (
              <span role="status" className="text-sm text-brand-dark">
                {t('reviews.settings.saved')}
              </span>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
