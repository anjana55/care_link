'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { normalizeMeasurementId } from '@care-platform/shared';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import {
  useAnalyticsSettings,
  useUpdateAnalyticsSettings,
  type AnalyticsSettings,
} from '@/lib/hooks/use-analytics-settings';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';

type Draft = { enabled: boolean; measurementId: string };

function toDraft(s: AnalyticsSettings): Draft {
  return { enabled: s.enabled, measurementId: s.measurementId ?? '' };
}

/**
 * Settings > Analytics (admin): Google Analytics 4 for the public site - the
 * measurement ID and an on/off switch. Only the public signed-out pages are
 * measured, without query strings; never this staff app or anyone's account.
 * The ID is checked here with the same rule the API enforces.
 */
export default function AnalyticsSettingsPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { data: settings, isLoading } = useAnalyticsSettings();
  const save = useUpdateAnalyticsSettings();
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

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setSaved(false);
    setError(null);
    setDraft({ ...draft, [key]: value });
  };

  const measurementId = normalizeMeasurementId(draft.measurementId);
  const idBad = draft.measurementId.trim() !== '' && !measurementId;
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(settings));
  const valid = !idBad && !(draft.enabled && !measurementId);
  const live = settings.enabled && Boolean(settings.measurementId);

  const submit = () => {
    save.mutate(
      // The canonical form, so a pasted Google tag snippet saves as just the ID.
      { enabled: draft.enabled, measurementId: measurementId ?? '' },
      {
        onSuccess: (data) => {
          setDraft(toDraft(data));
          setError(null);
          setSaved(true);
          setTimeout(() => setSaved(false), 3000);
        },
        onError: (err) => setError(err instanceof ApiError && err.message ? err.message : t('analyticsAdmin.saveError')),
      },
    );
  };

  return (
    <div className="max-w-3xl">
      <h2 className="mb-1 text-lg font-semibold text-ink">{t('analyticsAdmin.title')}</h2>
      <p className="mb-4 text-sm text-ink/60">{t('analyticsAdmin.subtitle')}</p>

      <div
        role="status"
        className={`mb-6 rounded-md border px-4 py-3 text-sm ${live ? 'border-brand/30 bg-brand-light/40 text-brand-dark' : 'border-border bg-paper text-ink/70'}`}
      >
        {live ? t('analyticsAdmin.statusLive') : t('analyticsAdmin.statusOff')}
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader><CardTitle>{t('analyticsAdmin.propertyTitle')}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="measurementId" required={draft.enabled}>{t('analyticsAdmin.measurementId')}</Label>
              <Input
                id="measurementId"
                autoComplete="off"
                spellCheck={false}
                placeholder="G-AB12CD34EF"
                value={draft.measurementId}
                aria-invalid={idBad}
                onChange={(e) => set('measurementId', e.target.value)}
                onBlur={() => measurementId && measurementId !== draft.measurementId && set('measurementId', measurementId)}
                className="max-w-sm"
              />
              <p className={`mt-1 text-xs ${idBad ? 'text-danger' : 'text-ink/50'}`}>
                {idBad ? t('analyticsAdmin.measurementIdInvalid') : t('analyticsAdmin.measurementIdHint')}
              </p>
            </div>

            <label htmlFor="enabled" className="flex items-start gap-3 py-1 text-sm">
              <input
                id="enabled"
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => set('enabled', e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded border-border text-brand focus:ring-brand"
              />
              <span>
                <span className="font-medium text-ink">{t('analyticsAdmin.enabled')}</span>
                <span className="block text-xs text-ink/50">{t('analyticsAdmin.enabledHint')}</span>
              </span>
            </label>
            {draft.enabled && !measurementId && <p className="text-xs text-danger">{t('analyticsAdmin.enabledNeedsId')}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('analyticsAdmin.setupTitle')}</CardTitle></CardHeader>
          <CardContent>
            <p className="mb-2 text-sm text-ink/60">{t('analyticsAdmin.setupIntro')}</p>
            <ul className="list-inside list-disc space-y-1 text-sm text-ink/70">
              <li>{t('analyticsAdmin.setupHistory')}</li>
              <li>{t('analyticsAdmin.setupSiteSearch')}</li>
              <li>{t('analyticsAdmin.setupCheck')}</li>
            </ul>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('analyticsAdmin.whereTitle')}</CardTitle></CardHeader>
          <CardContent>
            <ul className="list-inside list-disc space-y-1 text-sm text-ink/70">
              <li>{t('analyticsAdmin.whereShown')}</li>
              <li>{t('analyticsAdmin.whereNever')}</li>
              <li>{t('analyticsAdmin.whereQuery')}</li>
              <li>{t('analyticsAdmin.whereConsent')}</li>
            </ul>
          </CardContent>
        </Card>

        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={save.isPending || !dirty || !valid}>
            {save.isPending ? t('common.loading') : t('common.save')}
          </Button>
          {saved && <span className="text-sm text-brand-dark">{t('analyticsAdmin.saved')}</span>}
        </div>
      </div>
    </div>
  );
}
