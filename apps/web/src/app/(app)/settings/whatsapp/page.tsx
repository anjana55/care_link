'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { useWhatsappSettings } from '@/lib/hooks/use-whatsapp';
import { api, ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import type { WhatsappSettings } from '@/lib/api/types';

type Draft = Omit<WhatsappSettings, 'accessTokenSet' | 'accessTokenHint' | 'updatedAt'> & { accessToken: string; clearAccessToken: boolean };

function toDraft(s: WhatsappSettings): Draft {
  const { accessTokenSet: _a, accessTokenHint: _h, updatedAt: _u, ...rest } = s;
  return { ...rest, accessToken: '', clearAccessToken: false };
}

function Toggle({ id, label, hint, checked, onChange, disabled }: { id: string; label: string; hint?: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean }) {
  return (
    <label htmlFor={id} className={`flex items-start gap-3 py-2 text-sm ${disabled ? 'opacity-50' : ''}`}>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-border text-brand focus:ring-brand" />
      <span>
        <span className="font-medium text-ink">{label}</span>
        {hint && <span className="block text-xs text-ink/50">{hint}</span>}
      </span>
    </label>
  );
}

export default function WhatsappSettingsPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useWhatsappSettings();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testPhone, setTestPhone] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Admin-only, same guard as the Users page.
  useEffect(() => {
    if (authLoading) return;
    if (user && user.role !== 'ADMIN') router.replace('/dashboard');
  }, [authLoading, user, router]);

  useEffect(() => {
    if (settings) setDraft(toDraft(settings));
  }, [settings]);

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const { accessToken, clearAccessToken, phoneNumberId, businessAccountId, ...rest } = d;
      return api.patch<WhatsappSettings>('/settings/whatsapp', {
        ...rest,
        // Blank optional IDs are omitted rather than sent as '' (which the API would reject).
        ...(phoneNumberId ? { phoneNumberId } : {}),
        ...(businessAccountId ? { businessAccountId } : {}),
        // Write-only: only sent when the admin typed a new value or asked to remove it.
        ...(accessToken ? { accessToken } : {}),
        ...(clearAccessToken ? { clearAccessToken: true } : {}),
      });
    },
    onSuccess: (s) => {
      queryClient.setQueryData(['whatsapp-settings'], s);
      queryClient.invalidateQueries({ queryKey: ['whatsapp-config'] });
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
    onError: (err: unknown) => {
      setSaved(false);
      setError(err instanceof ApiError ? err.message : t('whatsappAdmin.saveError'));
    },
  });

  const test = useMutation({
    mutationFn: () => api.post<{ message: string }>('/settings/whatsapp/test', { phone: testPhone }),
    onSuccess: (r) => setTestResult({ ok: true, message: r.message }),
    onError: (err: unknown) => setTestResult({ ok: false, message: err instanceof ApiError ? err.message : t('whatsappAdmin.saveError') }),
  });

  if (authLoading || !user || user.role !== 'ADMIN' || isLoading || !draft || !settings) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setSaved(false);
    setDraft({ ...draft, [key]: value });
  };
  const num = (key: keyof Draft) => (e: React.ChangeEvent<HTMLInputElement>) => set(key, (e.target.value === '' ? 0 : Number(e.target.value)) as never);
  const meta = draft.provider === 'META_CLOUD';
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(settings));

  return (
    <div className="max-w-3xl">
      <h2 className="mb-1 text-lg font-semibold text-ink">{t('whatsappAdmin.title')}</h2>
      <p className="mb-6 text-sm text-ink/60">{t('whatsappAdmin.subtitle')}</p>

      <div className="space-y-5">
        <Card>
          <CardHeader><CardTitle>{t('whatsappAdmin.togglesTitle')}</CardTitle></CardHeader>
          <CardContent>
            <Toggle id="enabled" label={t('whatsappAdmin.enabled')} hint={t('whatsappAdmin.enabledHint')} checked={draft.enabled} onChange={(v) => set('enabled', v)} />
            <div className="mt-1 grid gap-x-8 border-t border-border pt-2 sm:grid-cols-2">
              <Toggle id="caregiverEnabled" label={t('whatsappAdmin.caregivers')} checked={draft.caregiverEnabled} onChange={(v) => set('caregiverEnabled', v)} disabled={!draft.enabled} />
              <Toggle id="customerEnabled" label={t('whatsappAdmin.customers')} checked={draft.customerEnabled} onChange={(v) => set('customerEnabled', v)} disabled={!draft.enabled} />
              <Toggle id="registrationEnabled" label={t('whatsappAdmin.registration')} hint={t('whatsappAdmin.registrationHint')} checked={draft.registrationEnabled} onChange={(v) => set('registrationEnabled', v)} disabled={!draft.enabled} />
              <Toggle id="loginEnabled" label={t('whatsappAdmin.login')} checked={draft.loginEnabled} onChange={(v) => set('loginEnabled', v)} disabled={!draft.enabled} />
              <Toggle id="recoveryEnabled" label={t('whatsappAdmin.recovery')} checked={draft.recoveryEnabled} onChange={(v) => set('recoveryEnabled', v)} disabled={!draft.enabled} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('whatsappAdmin.deliveryTitle')}</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="provider">{t('whatsappAdmin.provider')}</Label>
              <Select id="provider" value={draft.provider} onChange={(e) => set('provider', e.target.value as Draft['provider'])}>
                <option value="META_CLOUD">{t('whatsappAdmin.providerMeta')}</option>
                <option value="CONSOLE">{t('whatsappAdmin.providerConsole')}</option>
              </Select>
              {!meta && <p className="mt-1 text-xs text-ink/50">{t('whatsappAdmin.consoleHint')}</p>}
            </div>
            {meta && (
              <>
                <div>
                  <Label htmlFor="phoneNumberId" required>{t('whatsappAdmin.phoneNumberId')}</Label>
                  <Input id="phoneNumberId" value={draft.phoneNumberId ?? ''} onChange={(e) => set('phoneNumberId', e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="businessAccountId">{t('whatsappAdmin.businessAccountId')}</Label>
                  <Input id="businessAccountId" value={draft.businessAccountId ?? ''} onChange={(e) => set('businessAccountId', e.target.value)} />
                </div>
                <div className="sm:col-span-2">
                  <Label htmlFor="accessToken" required>{t('whatsappAdmin.accessToken')}</Label>
                  <Input
                    id="accessToken"
                    type="password"
                    autoComplete="new-password"
                    placeholder={settings.accessTokenSet && !draft.clearAccessToken ? `${settings.accessTokenHint} — ${t('whatsappAdmin.tokenKeep')}` : ''}
                    value={draft.accessToken}
                    onChange={(e) => setDraft({ ...draft, accessToken: e.target.value, clearAccessToken: false })}
                  />
                  <p className="mt-1 text-xs text-ink/50">{t('whatsappAdmin.tokenHint')}</p>
                  {settings.accessTokenSet && (
                    <label className="mt-2 flex items-center gap-2 text-xs text-ink/70">
                      <input type="checkbox" checked={draft.clearAccessToken} onChange={(e) => setDraft({ ...draft, clearAccessToken: e.target.checked, accessToken: '' })} className="h-3.5 w-3.5 rounded border-border text-brand focus:ring-brand" />
                      {t('whatsappAdmin.tokenRemove')}
                    </label>
                  )}
                </div>
                <div>
                  <Label htmlFor="apiBaseUrl">{t('whatsappAdmin.apiBaseUrl')}</Label>
                  <Input id="apiBaseUrl" value={draft.apiBaseUrl} onChange={(e) => set('apiBaseUrl', e.target.value)} />
                </div>
                <div>
                  <Label htmlFor="apiVersion">{t('whatsappAdmin.apiVersion')}</Label>
                  <Input id="apiVersion" value={draft.apiVersion} onChange={(e) => set('apiVersion', e.target.value)} />
                </div>
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('whatsappAdmin.templateTitle')}</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="templateName">{t('whatsappAdmin.templateName')}</Label>
              <Input id="templateName" value={draft.templateName} onChange={(e) => set('templateName', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="templateLanguage">{t('whatsappAdmin.templateLanguage')}</Label>
              <Input id="templateLanguage" value={draft.templateLanguage} onChange={(e) => set('templateLanguage', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Toggle id="copyCode" label={t('whatsappAdmin.copyCode')} hint={t('whatsappAdmin.templateHint')} checked={draft.templateHasCopyCodeButton} onChange={(v) => set('templateHasCopyCodeButton', v)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('whatsappAdmin.otpTitle')}</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="otpLength">{t('whatsappAdmin.otpLength')}</Label>
              <Input id="otpLength" type="number" min={4} max={8} value={draft.otpLength} onChange={num('otpLength')} />
            </div>
            <div>
              <Label htmlFor="otpTtlSeconds">{t('whatsappAdmin.otpTtl')}</Label>
              <Input id="otpTtlSeconds" type="number" min={60} max={900} value={draft.otpTtlSeconds} onChange={num('otpTtlSeconds')} />
            </div>
            <div>
              <Label htmlFor="otpMaxAttempts">{t('whatsappAdmin.otpAttempts')}</Label>
              <Input id="otpMaxAttempts" type="number" min={3} max={10} value={draft.otpMaxAttempts} onChange={num('otpMaxAttempts')} />
            </div>
            <div>
              <Label htmlFor="otpResendCooldownSeconds">{t('whatsappAdmin.otpCooldown')}</Label>
              <Input id="otpResendCooldownSeconds" type="number" min={15} max={600} value={draft.otpResendCooldownSeconds} onChange={num('otpResendCooldownSeconds')} />
            </div>
            <div>
              <Label htmlFor="otpMaxSendsPerHour">{t('whatsappAdmin.otpPerHour')}</Label>
              <Input id="otpMaxSendsPerHour" type="number" min={1} max={20} value={draft.otpMaxSendsPerHour} onChange={num('otpMaxSendsPerHour')} />
            </div>
            <div>
              <Label htmlFor="defaultCountryCode">{t('whatsappAdmin.countryCode')}</Label>
              <Input id="defaultCountryCode" value={draft.defaultCountryCode} onChange={(e) => set('defaultCountryCode', e.target.value)} />
              <p className="mt-1 text-xs text-ink/50">{t('whatsappAdmin.countryCodeHint')}</p>
            </div>
          </CardContent>
        </Card>

        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex items-center gap-3">
          <Button onClick={() => save.mutate(draft)} disabled={save.isPending || !dirty}>
            {save.isPending ? t('common.loading') : t('common.save')}
          </Button>
          {saved && <span className="text-sm text-brand-dark">{t('whatsappAdmin.saved')}</span>}
        </div>

        <Card>
          <CardHeader><CardTitle>{t('whatsappAdmin.testTitle')}</CardTitle></CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-ink/50">{t('whatsappAdmin.testHint')}</p>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Label htmlFor="testPhone">{t('whatsappAdmin.testPhone')}</Label>
                <Input id="testPhone" type="tel" placeholder="0771234567" value={testPhone} onChange={(e) => setTestPhone(e.target.value)} />
              </div>
              <Button variant="secondary" onClick={() => { setTestResult(null); test.mutate(); }} disabled={test.isPending || testPhone.trim().length < 7 || dirty}>
                {test.isPending ? t('common.loading') : t('whatsappAdmin.testSend')}
              </Button>
            </div>
            {dirty && <p className="mt-2 text-xs text-ink/50">{t('whatsappAdmin.testSaveFirst')}</p>}
            {testResult && <p className={`mt-3 text-sm ${testResult.ok ? 'text-brand-dark' : 'text-danger'}`}>{testResult.message}</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
