'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { APP_PLATFORMS, APP_VERSION_RE, compareAppVersions, isStoreUrl, type AppPlatform } from '@care-platform/shared';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import {
  useMobileAppSettings,
  useUpdateMobileAppSettings,
  type MobileAppSettings,
} from '@/lib/hooks/use-mobile-app-settings';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';

type PlatformDraft = { minimumVersion: string; latestVersion: string; storeUrl: string };
type Draft = Record<AppPlatform, PlatformDraft>;

function toDraft(s: MobileAppSettings): Draft {
  const one = (p: AppPlatform): PlatformDraft => ({
    minimumVersion: s[p].minimumVersion ?? '',
    latestVersion: s[p].latestVersion ?? '',
    storeUrl: s[p].storeUrl ?? '',
  });
  return { ios: one('ios'), android: one('android') };
}

/** What's wrong with one platform's fields, by field - the same rules the API enforces. */
function problems(platform: AppPlatform, d: PlatformDraft) {
  const min = d.minimumVersion.trim();
  const latest = d.latestVersion.trim();
  const url = d.storeUrl.trim();
  return {
    minimumVersion: min && !APP_VERSION_RE.test(min) ? 'versionInvalid' : null,
    latestVersion:
      latest && !APP_VERSION_RE.test(latest)
        ? 'versionInvalid'
        : min && latest && compareAppVersions(min, latest) === 1
          ? 'minAboveLatest'
          : null,
    storeUrl: url && !isStoreUrl(platform, url) ? 'storeUrlInvalid' : min && !url ? 'minNeedsStore' : null,
  } as const;
}

/**
 * Settings > Mobile app (admin): per platform, the minimum version that may
 * still be used (older builds stop and must update), the latest version (older
 * builds are offered an update) and the store link they update from. The app
 * reads this every time it opens (GET /public/app-config).
 */
export default function MobileAppSettingsPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { data: settings, isLoading } = useMobileAppSettings();
  const save = useUpdateMobileAppSettings();
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

  const set = (platform: AppPlatform, key: keyof PlatformDraft, value: string) => {
    setSaved(false);
    setError(null);
    setDraft({ ...draft, [platform]: { ...draft[platform], [key]: value } });
  };

  const issues = { ios: problems('ios', draft.ios), android: problems('android', draft.android) };
  const valid = APP_PLATFORMS.every((p) => Object.values(issues[p]).every((v) => !v));
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(settings));
  const anyCheck = APP_PLATFORMS.some((p) => settings[p].minimumVersion || settings[p].latestVersion);
  // Saving a higher minimum than before stops people the next time they open the app.
  const raising = APP_PLATFORMS.some((p) => {
    const next = draft[p].minimumVersion.trim();
    const before = settings[p].minimumVersion;
    return next && APP_VERSION_RE.test(next) && (!before || compareAppVersions(next, before) === 1);
  });

  const submit = () => {
    const body = Object.fromEntries(
      APP_PLATFORMS.map((p) => [
        p,
        { minimumVersion: draft[p].minimumVersion.trim(), latestVersion: draft[p].latestVersion.trim(), storeUrl: draft[p].storeUrl.trim() },
      ]),
    );
    save.mutate(body, {
      onSuccess: (data) => {
        setDraft(toDraft(data));
        setError(null);
        setSaved(true);
        setTimeout(() => setSaved(false), 3000);
      },
      onError: (err) => setError(err instanceof ApiError && err.message ? err.message : t('mobileAppAdmin.saveError')),
    });
  };

  return (
    <div className="max-w-3xl">
      <h2 className="mb-1 text-lg font-semibold text-ink">{t('mobileAppAdmin.title')}</h2>
      <p className="mb-4 text-sm text-ink/60">{t('mobileAppAdmin.subtitle')}</p>

      <div
        role="status"
        className={`mb-6 rounded-md border px-4 py-3 text-sm ${anyCheck ? 'border-brand/30 bg-brand-light/40 text-brand-dark' : 'border-border bg-paper text-ink/70'}`}
      >
        {anyCheck ? t('mobileAppAdmin.statusOn') : t('mobileAppAdmin.statusOff')}
      </div>

      <div className="space-y-5">
        {APP_PLATFORMS.map((platform) => {
          const d = draft[platform];
          const bad = issues[platform];
          const field = (key: keyof PlatformDraft, label: string, hint: string, placeholder: string, wide = false) => {
            const id = `${platform}-${key}`;
            const problem = bad[key];
            return (
              <div>
                <Label htmlFor={id}>{label}</Label>
                <Input
                  id={id}
                  autoComplete="off"
                  spellCheck={false}
                  inputMode={key === 'storeUrl' ? 'url' : 'decimal'}
                  placeholder={placeholder}
                  value={d[key]}
                  aria-invalid={Boolean(problem)}
                  aria-describedby={`${id}-hint`}
                  onChange={(e) => set(platform, key, e.target.value)}
                  className={wide ? 'max-w-xl' : 'max-w-[10rem]'}
                />
                <p id={`${id}-hint`} className={`mt-1 text-xs ${problem ? 'text-danger' : 'text-ink/50'}`}>
                  {problem ? t(`mobileAppAdmin.${problem}`) : hint}
                </p>
              </div>
            );
          };
          return (
            <Card key={platform}>
              <CardHeader>
                <CardTitle>{t(`mobileAppAdmin.${platform}`)}</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                {field('minimumVersion', t('mobileAppAdmin.minimumVersion'), t('mobileAppAdmin.minimumHint'), '1.0.0')}
                {field('latestVersion', t('mobileAppAdmin.latestVersion'), t('mobileAppAdmin.latestHint'), '1.0.0')}
                {field(
                  'storeUrl',
                  t('mobileAppAdmin.storeUrl'),
                  t(platform === 'ios' ? 'mobileAppAdmin.storeUrlHintIos' : 'mobileAppAdmin.storeUrlHintAndroid'),
                  platform === 'ios' ? 'https://apps.apple.com/app/id…' : 'https://play.google.com/store/apps/details?id=…',
                  true,
                )}
              </CardContent>
            </Card>
          );
        })}

        {raising && dirty && (
          <p role="alert" className="rounded-md border border-danger/30 bg-danger/5 px-4 py-3 text-sm text-danger">
            {t('mobileAppAdmin.raiseWarning')}
          </p>
        )}
        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={save.isPending || !dirty || !valid}>
            {save.isPending ? t('common.loading') : t('common.save')}
          </Button>
          {saved && <span className="text-sm text-brand-dark">{t('mobileAppAdmin.saved')}</span>}
        </div>
      </div>
    </div>
  );
}
