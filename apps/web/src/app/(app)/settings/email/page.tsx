'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { useEmailSettings } from '@/lib/hooks/use-email-settings';
import { api, ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import type { EmailSettings } from '@/lib/api/types';

type Draft = {
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  username: string;
  password: string;
  clearPassword: boolean;
  fromName: string;
  fromAddress: string;
  replyTo: string;
  requestAlertsTo: string;
};

function toDraft(s: EmailSettings): Draft {
  return {
    enabled: s.enabled,
    host: s.host ?? '',
    port: s.port,
    secure: s.secure,
    username: s.username ?? '',
    password: '',
    clearPassword: false,
    fromName: s.fromName,
    fromAddress: s.fromAddress ?? '',
    replyTo: s.replyTo ?? '',
    requestAlertsTo: s.requestAlertsTo ?? '',
  };
}

export default function EmailSettingsPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useEmailSettings();

  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testResult, setTestResult] = useState<{ ok: boolean; message: string } | null>(null);

  // Admin-only, same guard as the other Settings sections.
  useEffect(() => {
    if (authLoading) return;
    if (user && user.role !== 'ADMIN') router.replace('/dashboard');
  }, [authLoading, user, router]);

  useEffect(() => {
    if (settings) setDraft(toDraft(settings));
  }, [settings]);

  // Prefill the test recipient with the admin's own address - the usual target.
  useEffect(() => {
    if (user?.email && !testTo) setTestTo(user.email);
  }, [user, testTo]);

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const { password, clearPassword, ...rest } = d;
      return api.patch<EmailSettings>('/settings/email', {
        ...rest,
        // Write-only: only sent when the admin typed a new one or asked to remove it.
        ...(password ? { password } : {}),
        ...(clearPassword ? { clearPassword: true } : {}),
      });
    },
    onSuccess: (s) => {
      queryClient.setQueryData(['email-settings'], s);
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
    onError: (err: unknown) => {
      setSaved(false);
      setError(err instanceof ApiError ? err.message : t('emailAdmin.saveError'));
    },
  });

  const test = useMutation({
    mutationFn: () => api.post<{ success: boolean; message: string }>('/settings/email/test', { to: testTo.trim() }),
    onSuccess: (r) => setTestResult({ ok: r.success, message: r.message }),
    onError: (err: unknown) => setTestResult({ ok: false, message: err instanceof ApiError ? err.message : t('emailAdmin.saveError') }),
  });

  if (authLoading || !user || user.role !== 'ADMIN' || isLoading || !draft || !settings) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setSaved(false);
    setDraft({ ...draft, [key]: value });
  };
  // Switching between the two standard modes moves the port with it, unless the
  // admin has already typed a non-standard one.
  const setSecurity = (secure: boolean) => {
    const port = secure && draft.port === 587 ? 465 : !secure && draft.port === 465 ? 587 : draft.port;
    setSaved(false);
    setDraft({ ...draft, secure, port });
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(settings));
  const savedComplete = Boolean(settings.host && settings.fromAddress);

  return (
    <div className="max-w-3xl">
      <h2 className="mb-1 text-lg font-semibold text-ink">{t('emailAdmin.title')}</h2>
      <p className="mb-4 text-sm text-ink/60">{t('emailAdmin.subtitle')}</p>

      <div
        role="status"
        className={`mb-6 rounded-md border px-4 py-3 text-sm ${settings.usable ? 'border-brand/30 bg-brand-light/40 text-brand-dark' : 'border-border bg-paper text-ink/70'}`}
      >
        {settings.usable ? t('emailAdmin.statusLive') : t('emailAdmin.statusOff')}
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader><CardTitle>{t('emailAdmin.deliveryTitle')}</CardTitle></CardHeader>
          <CardContent>
            <label htmlFor="enabled" className="flex items-start gap-3 py-2 text-sm">
              <input id="enabled" type="checkbox" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-border text-brand focus:ring-brand" />
              <span>
                <span className="font-medium text-ink">{t('emailAdmin.enabled')}</span>
                <span className="block text-xs text-ink/50">{t('emailAdmin.enabledHint')}</span>
              </span>
            </label>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('emailAdmin.serverTitle')}</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="sm:col-span-2">
              <Label htmlFor="host" required>{t('emailAdmin.host')}</Label>
              <Input id="host" placeholder="smtp.example.com" autoComplete="off" value={draft.host} onChange={(e) => set('host', e.target.value)} />
              <p className="mt-1 text-xs text-ink/50">{t('emailAdmin.hostHint')}</p>
            </div>
            <div>
              <Label htmlFor="security">{t('emailAdmin.security')}</Label>
              <Select id="security" value={draft.secure ? 'tls' : 'starttls'} onChange={(e) => setSecurity(e.target.value === 'tls')}>
                <option value="starttls">{t('emailAdmin.securityStarttls')}</option>
                <option value="tls">{t('emailAdmin.securityTls')}</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="port" required>{t('emailAdmin.port')}</Label>
              <Input id="port" type="number" min={1} max={65535} value={draft.port} onChange={(e) => set('port', e.target.value === '' ? 0 : Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="username">{t('emailAdmin.username')}</Label>
              <Input id="username" autoComplete="off" value={draft.username} onChange={(e) => set('username', e.target.value)} />
              <p className="mt-1 text-xs text-ink/50">{t('emailAdmin.usernameHint')}</p>
            </div>
            <div>
              <Label htmlFor="password">{t('emailAdmin.password')}</Label>
              <Input
                id="password"
                type="password"
                autoComplete="new-password"
                placeholder={settings.passwordSet && !draft.clearPassword ? t('emailAdmin.passwordKeep') : ''}
                value={draft.password}
                disabled={!draft.username.trim()}
                onChange={(e) => setDraft({ ...draft, password: e.target.value, clearPassword: false })}
              />
              <p className="mt-1 text-xs text-ink/50">{t('emailAdmin.passwordHint')}</p>
              {settings.passwordSet && draft.username.trim() && (
                <label className="mt-2 flex items-center gap-2 text-xs text-ink/70">
                  <input type="checkbox" checked={draft.clearPassword} onChange={(e) => setDraft({ ...draft, clearPassword: e.target.checked, password: '' })} className="h-3.5 w-3.5 rounded border-border text-brand focus:ring-brand" />
                  {t('emailAdmin.passwordRemove')}
                </label>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('emailAdmin.senderTitle')}</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="fromName">{t('emailAdmin.fromName')}</Label>
              <Input id="fromName" value={draft.fromName} onChange={(e) => set('fromName', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="fromAddress" required>{t('emailAdmin.fromAddress')}</Label>
              <Input id="fromAddress" type="email" placeholder="no-reply@example.com" value={draft.fromAddress} onChange={(e) => set('fromAddress', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="replyTo">{t('emailAdmin.replyTo')}</Label>
              <Input id="replyTo" type="email" value={draft.replyTo} onChange={(e) => set('replyTo', e.target.value)} />
              <p className="mt-1 text-xs text-ink/50">{t('emailAdmin.senderHint')}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('emailAdmin.requestAlertsTitle')}</CardTitle></CardHeader>
          <CardContent>
            <Label htmlFor="requestAlertsTo">{t('emailAdmin.requestAlertsTo')}</Label>
            <Input
              id="requestAlertsTo"
              placeholder="bookings@example.com, ops@example.com"
              value={draft.requestAlertsTo}
              onChange={(e) => set('requestAlertsTo', e.target.value)}
            />
            <p className="mt-1 text-xs text-ink/50">{t('emailAdmin.requestAlertsHint')}</p>
          </CardContent>
        </Card>

        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex items-center gap-3">
          <Button onClick={() => save.mutate(draft)} disabled={save.isPending || !dirty}>
            {save.isPending ? t('common.loading') : t('common.save')}
          </Button>
          {saved && <span className="text-sm text-brand-dark">{t('emailAdmin.saved')}</span>}
        </div>

        <Card>
          <CardHeader><CardTitle>{t('emailAdmin.testTitle')}</CardTitle></CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-ink/50">{t('emailAdmin.testHint')}</p>
            <div className="flex items-end gap-3">
              <div className="flex-1">
                <Label htmlFor="testTo">{t('emailAdmin.testTo')}</Label>
                <Input id="testTo" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} />
              </div>
              <Button
                variant="secondary"
                onClick={() => { setTestResult(null); test.mutate(); }}
                disabled={test.isPending || !/^\S+@\S+\.\S+$/.test(testTo.trim()) || dirty || !savedComplete}
              >
                {test.isPending ? t('emailAdmin.testSending') : t('emailAdmin.testSend')}
              </Button>
            </div>
            {dirty && <p className="mt-2 text-xs text-ink/50">{t('emailAdmin.testSaveFirst')}</p>}
            {!dirty && !savedComplete && <p className="mt-2 text-xs text-ink/50">{t('emailAdmin.testNeedsServer')}</p>}
            {testResult && <p className={`mt-3 text-sm ${testResult.ok ? 'text-brand-dark' : 'text-danger'}`}>{testResult.message}</p>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
