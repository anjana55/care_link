'use client';

import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { useSocialAuthSettings } from '@/lib/hooks/use-social-auth-settings';
import { api, ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label } from '@/components/ui/input';
import type { SocialProviderName, SocialProviderSettings } from '@/lib/api/types';

interface Draft {
  enabled: boolean;
  clientId: string;
  clientSecret: string;
  clearClientSecret: boolean;
  tenant: string;
  apiVersion: string;
}

const toDraft = (s: SocialProviderSettings): Draft => ({
  enabled: s.enabled,
  clientId: s.clientId ?? '',
  clientSecret: '',
  clearClientSecret: false,
  tenant: s.tenant,
  apiVersion: s.apiVersion,
});

/** Where an admin creates the OAuth client for each provider. */
const CONSOLES: Record<SocialProviderName, string> = {
  GOOGLE: 'https://console.cloud.google.com/apis/credentials',
  MICROSOFT: 'https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade',
  FACEBOOK: 'https://developers.facebook.com/apps/',
};

function ProviderCard({ settings }: { settings: SocialProviderSettings }) {
  const { t } = useTranslation();
  const queryClient = useQueryClient();
  const name = settings.provider;
  const key = name.toLowerCase();

  const [draft, setDraft] = useState<Draft>(() => toDraft(settings));
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [copied, setCopied] = useState(false);
  const [check, setCheck] = useState<{ ok: boolean; message: string } | null>(null);

  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(settings));
  const set = <K extends keyof Draft>(k: K, v: Draft[K]) => {
    setSaved(false);
    setCheck(null);
    setDraft((d) => ({ ...d, [k]: v }));
  };

  const save = useMutation({
    mutationFn: () =>
      api.patch<SocialProviderSettings>(`/settings/social-auth/${key}`, {
        enabled: draft.enabled,
        clientId: draft.clientId.trim(),
        ...(name === 'MICROSOFT' ? { tenant: draft.tenant.trim() } : {}),
        ...(name === 'FACEBOOK' ? { apiVersion: draft.apiVersion.trim() } : {}),
        // Write-only: sent only when the admin typed a new value or asked to remove it.
        ...(draft.clientSecret ? { clientSecret: draft.clientSecret } : {}),
        ...(draft.clearClientSecret ? { clearClientSecret: true } : {}),
      }),
    onSuccess: (next) => {
      queryClient.setQueryData<SocialProviderSettings[]>(['social-auth-settings'], (list) =>
        list?.map((p) => (p.provider === next.provider ? next : p)),
      );
      // The public sign-in screens read availability from here.
      queryClient.invalidateQueries({ queryKey: ['social-providers'] });
      setDraft(toDraft(next));
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
    onError: (err: unknown) => {
      setSaved(false);
      setError(err instanceof ApiError ? err.message : t('socialAdmin.saveError'));
    },
  });

  const test = useMutation({
    mutationFn: () => api.post<{ ok: boolean; message: string }>(`/settings/social-auth/${key}/test`),
    onSuccess: (r) => setCheck({ ok: r.ok, message: r.message }),
    onError: (err: unknown) => setCheck({ ok: false, message: err instanceof ApiError ? err.message : t('socialAdmin.saveError') }),
  });

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(settings.redirectUri);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard can be unavailable (insecure origin); the URL is selectable text anyway */
    }
  };

  const status = settings.usable ? 'live' : settings.enabled ? 'incomplete' : 'off';
  const statusStyle = {
    live: 'bg-brand-light text-brand-dark',
    incomplete: 'bg-amber-100 text-amber-800',
    off: 'bg-paper text-ink/60',
  }[status];

  return (
    <Card aria-label={t(`socialAdmin.providers.${name}`)}>
      <CardHeader className="flex items-center justify-between gap-3">
        <CardTitle>{t(`socialAdmin.providers.${name}`)}</CardTitle>
        <span className={`rounded-full px-2.5 py-0.5 text-xs font-medium ${statusStyle}`}>{t(`socialAdmin.status.${status}`)}</span>
      </CardHeader>
      <CardContent className="space-y-4">
        <label htmlFor={`${key}-enabled`} className="flex items-start gap-3 text-sm">
          <input
            id={`${key}-enabled`}
            type="checkbox"
            checked={draft.enabled}
            onChange={(e) => set('enabled', e.target.checked)}
            className="mt-0.5 h-4 w-4 rounded border-border text-brand focus:ring-brand"
          />
          <span>
            <span className="font-medium text-ink">{t('socialAdmin.enabled')}</span>
            <span className="block text-xs text-ink/50">{t('socialAdmin.enabledHint')}</span>
          </span>
        </label>

        <div className="rounded border border-border bg-paper p-3">
          <p className="mb-1 text-xs font-medium text-ink/70">{t('socialAdmin.redirectUri')}</p>
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 break-all text-xs text-ink">{settings.redirectUri}</code>
            <Button type="button" variant="secondary" size="sm" onClick={copy}>
              {copied ? t('socialAdmin.copied') : t('socialAdmin.copy')}
            </Button>
          </div>
          <p className="mt-2 text-xs text-ink/50">
            {t('socialAdmin.redirectUriHint')}{' '}
            <a href={CONSOLES[name]} target="_blank" rel="noreferrer" className="text-brand-dark underline">
              {t('socialAdmin.openConsole')}
            </a>
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Label htmlFor={`${key}-clientId`}>{t(`socialAdmin.clientId.${name}`)}</Label>
            <Input id={`${key}-clientId`} value={draft.clientId} autoComplete="off" onChange={(e) => set('clientId', e.target.value)} />
          </div>

          <div className="sm:col-span-2">
            <Label htmlFor={`${key}-secret`}>{t(`socialAdmin.clientSecret.${name}`)}</Label>
            <Input
              id={`${key}-secret`}
              type="password"
              autoComplete="new-password"
              placeholder={settings.clientSecretSet && !draft.clearClientSecret ? `${settings.clientSecretHint} — ${t('socialAdmin.secretKeep')}` : ''}
              value={draft.clientSecret}
              onChange={(e) => setDraft((d) => ({ ...d, clientSecret: e.target.value, clearClientSecret: false }))}
            />
            <p className="mt-1 text-xs text-ink/50">{t('socialAdmin.secretHint')}</p>
            {settings.clientSecretSet && (
              <label className="mt-2 flex items-center gap-2 text-xs text-ink/70">
                <input
                  type="checkbox"
                  checked={draft.clearClientSecret}
                  onChange={(e) => setDraft((d) => ({ ...d, clearClientSecret: e.target.checked, clientSecret: '' }))}
                  className="h-3.5 w-3.5 rounded border-border text-brand focus:ring-brand"
                />
                {t('socialAdmin.secretRemove')}
              </label>
            )}
          </div>

          {name === 'MICROSOFT' && (
            <div className="sm:col-span-2">
              <Label htmlFor="microsoft-tenant">{t('socialAdmin.tenant')}</Label>
              <Input id="microsoft-tenant" value={draft.tenant} onChange={(e) => set('tenant', e.target.value)} />
              <p className="mt-1 text-xs text-ink/50">{t('socialAdmin.tenantHint')}</p>
            </div>
          )}
          {name === 'FACEBOOK' && (
            <div>
              <Label htmlFor="facebook-apiVersion">{t('socialAdmin.apiVersion')}</Label>
              <Input id="facebook-apiVersion" value={draft.apiVersion} onChange={(e) => set('apiVersion', e.target.value)} />
            </div>
          )}
        </div>

        {error && <p role="alert" className="text-sm text-danger">{error}</p>}

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => save.mutate()} disabled={save.isPending || !dirty}>
            {save.isPending ? t('common.loading') : t('common.save')}
          </Button>
          <Button variant="secondary" onClick={() => { setCheck(null); test.mutate(); }} disabled={test.isPending || dirty || !settings.clientSecretSet}>
            {test.isPending ? t('common.loading') : t('socialAdmin.test')}
          </Button>
          {saved && <span className="text-sm text-brand-dark">{t('socialAdmin.saved')}</span>}
        </div>
        {dirty && settings.clientSecretSet && <p className="text-xs text-ink/50">{t('socialAdmin.testSaveFirst')}</p>}
        {check && (
          <p role="status" className={`text-sm ${check.ok ? 'text-brand-dark' : 'text-danger'}`}>
            {check.message}
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export default function SocialAuthSettingsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const { data, isLoading, isError } = useSocialAuthSettings();

  if (!user || user.role !== 'ADMIN' || isLoading) {
    return <div className="flex min-h-[30vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;
  }
  if (isError || !data) {
    return <p className="text-sm text-danger">{t('socialAdmin.loadError')}</p>;
  }

  return (
    <div className="max-w-3xl">
      <h2 className="mb-1 text-lg font-semibold text-ink">{t('socialAdmin.title')}</h2>
      <p className="mb-6 text-sm text-ink/60">{t('socialAdmin.subtitle')}</p>
      <div className="space-y-5">
        {data.map((p) => (
          <ProviderCard key={p.provider} settings={p} />
        ))}
      </div>
    </div>
  );
}
