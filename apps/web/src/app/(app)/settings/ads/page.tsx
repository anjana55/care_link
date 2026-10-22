'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, Copy } from 'lucide-react';
import { adsTxtLine, normalizePublisherId, normalizeSlotId, type AdPlacement } from '@care-platform/shared';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { useAdsSettings, useUpdateAdsSettings, type AdsSettings } from '@/lib/hooks/use-ads-settings';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';

type Draft = {
  enabled: boolean;
  publisherId: string;
  slotHome: string;
  slotSearch: string;
  slotProfile: string;
};

function toDraft(s: AdsSettings): Draft {
  return {
    enabled: s.enabled,
    publisherId: s.publisherId ?? '',
    slotHome: s.slotHome ?? '',
    slotSearch: s.slotSearch ?? '',
    slotProfile: s.slotProfile ?? '',
  };
}

const SLOTS: { field: 'slotHome' | 'slotSearch' | 'slotProfile'; placement: AdPlacement }[] = [
  { field: 'slotHome', placement: 'home' },
  { field: 'slotSearch', placement: 'search' },
  { field: 'slotProfile', placement: 'profile' },
];

// Where the public site lives. Same origin in production (the staff app is under /staff).
const PUBLIC_SITE = (process.env.NEXT_PUBLIC_PUBLIC_SITE_URL ?? '').replace(/\/+$/, '');

/**
 * Settings > Ads (admin): Google AdSense for the public site - the publisher ID,
 * an on/off switch and optional manually placed ad units. Ads only ever appear
 * on the public landing page, search and caregiver profiles; never in this
 * staff app, on sign-in pages or in anyone's account. The publisher ID is
 * checked here with the same rule the API enforces.
 */
export default function AdsSettingsPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { data: settings, isLoading } = useAdsSettings();
  const save = useUpdateAdsSettings();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);

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

  const publisherId = normalizePublisherId(draft.publisherId);
  const publisherBad = draft.publisherId.trim() !== '' && !publisherId;
  const slotBad = (v: string) => v.trim() !== '' && !normalizeSlotId(v);
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(settings));
  const valid = !publisherBad && !(draft.enabled && !publisherId) && SLOTS.every((s) => !slotBad(draft[s.field]));
  const adsTxt = publisherId ? adsTxtLine(publisherId) : settings.adsTxt;

  const submit = () => {
    save.mutate(
      {
        enabled: draft.enabled,
        // The canonical form, so a pasted script snippet saves as just the ID.
        publisherId: publisherId ?? '',
        slotHome: draft.slotHome.trim(),
        slotSearch: draft.slotSearch.trim(),
        slotProfile: draft.slotProfile.trim(),
      },
      {
        onSuccess: (data) => {
          setDraft(toDraft(data));
          setError(null);
          setSaved(true);
          setTimeout(() => setSaved(false), 3000);
        },
        onError: (err) => setError(err instanceof ApiError && err.message ? err.message : t('adsAdmin.saveError')),
      },
    );
  };

  const copyAdsTxt = async () => {
    if (!adsTxt) return;
    try {
      await navigator.clipboard.writeText(adsTxt);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard blocked - the line is selectable */
    }
  };

  const live = settings.enabled && Boolean(settings.publisherId);

  return (
    <div className="max-w-3xl">
      <h2 className="mb-1 text-lg font-semibold text-ink">{t('adsAdmin.title')}</h2>
      <p className="mb-4 text-sm text-ink/60">{t('adsAdmin.subtitle')}</p>

      <div
        role="status"
        className={`mb-6 rounded-md border px-4 py-3 text-sm ${live ? 'border-brand/30 bg-brand-light/40 text-brand-dark' : 'border-border bg-paper text-ink/70'}`}
      >
        {live ? t('adsAdmin.statusLive') : t('adsAdmin.statusOff')}
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader><CardTitle>{t('adsAdmin.accountTitle')}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div>
              <Label htmlFor="publisherId" required={draft.enabled}>{t('adsAdmin.publisherId')}</Label>
              <Input
                id="publisherId"
                autoComplete="off"
                spellCheck={false}
                placeholder="ca-pub-0123456789012345"
                value={draft.publisherId}
                aria-invalid={publisherBad}
                onChange={(e) => set('publisherId', e.target.value)}
                onBlur={() => publisherId && publisherId !== draft.publisherId && set('publisherId', publisherId)}
              />
              <p className={`mt-1 text-xs ${publisherBad ? 'text-danger' : 'text-ink/50'}`}>
                {publisherBad ? t('adsAdmin.publisherIdInvalid') : t('adsAdmin.publisherIdHint')}
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
                <span className="font-medium text-ink">{t('adsAdmin.enabled')}</span>
                <span className="block text-xs text-ink/50">{t('adsAdmin.enabledHint')}</span>
              </span>
            </label>
            {draft.enabled && !publisherId && <p className="text-xs text-danger">{t('adsAdmin.enabledNeedsId')}</p>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('adsAdmin.unitsTitle')}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-ink/60">{t('adsAdmin.unitsHint')}</p>
            {SLOTS.map(({ field, placement }) => (
              <div key={field}>
                <Label htmlFor={field}>{t(`adsAdmin.slot.${placement}`)}</Label>
                <Input
                  id={field}
                  inputMode="numeric"
                  autoComplete="off"
                  placeholder="1234567890"
                  value={draft[field]}
                  aria-invalid={slotBad(draft[field])}
                  onChange={(e) => set(field, e.target.value)}
                  className="max-w-xs"
                />
                <p className={`mt-1 text-xs ${slotBad(draft[field]) ? 'text-danger' : 'text-ink/50'}`}>
                  {slotBad(draft[field]) ? t('adsAdmin.slotInvalid') : t(`adsAdmin.slotHint.${placement}`)}
                </p>
              </div>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('adsAdmin.adsTxtTitle')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-ink/60">{t('adsAdmin.adsTxtHint', { url: `${PUBLIC_SITE}/ads.txt` })}</p>
            {adsTxt ? (
              <div className="flex items-center gap-2">
                <code className="flex-1 select-all overflow-x-auto whitespace-nowrap rounded-md border border-border bg-paper px-3 py-2 text-xs text-ink">{adsTxt}</code>
                <Button variant="secondary" onClick={copyAdsTxt} aria-label={t('adsAdmin.copy')}>
                  {copied ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                </Button>
              </div>
            ) : (
              <p className="text-xs text-ink/50">{t('adsAdmin.adsTxtEmpty')}</p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('adsAdmin.whereTitle')}</CardTitle></CardHeader>
          <CardContent>
            <ul className="list-inside list-disc space-y-1 text-sm text-ink/70">
              <li>{t('adsAdmin.whereShown')}</li>
              <li>{t('adsAdmin.whereNever')}</li>
              <li>{t('adsAdmin.whereConsent')}</li>
            </ul>
          </CardContent>
        </Card>

        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={save.isPending || !dirty || !valid}>
            {save.isPending ? t('common.loading') : t('common.save')}
          </Button>
          {saved && <span className="text-sm text-brand-dark">{t('adsAdmin.saved')}</span>}
        </div>
      </div>
    </div>
  );
}
