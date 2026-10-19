'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import type { AdminAiSettings, AiProvider, AiTestResult } from '@care-platform/shared';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { useAiSettings } from '@/lib/hooks/use-ai';
import { api, ApiError } from '@/lib/api/client';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select, Textarea } from '@/components/ui/input';

type Draft = {
  enabled: boolean;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  clearApiKey: boolean;
  /** '' = don't send one (the model's default). */
  temperature: string;
  maxTokens: number;
  timeoutSeconds: number;
  candidatePoolSize: number;
  publicSearchEnabled: boolean;
  staffMatchingEnabled: boolean;
  staffAssistantEnabled: boolean;
  searchPrompt: string;
  assistantPrompt: string;
};

/** A working starting point per provider; switching provider swaps it in only if the field still holds another default. */
const DEFAULTS: Record<AiProvider, { baseUrl: string; model: string }> = {
  OLLAMA: { baseUrl: 'http://localhost:11434', model: 'qwen2.5:7b-instruct' },
  OPENAI_COMPATIBLE: { baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  ANTHROPIC: { baseUrl: 'https://api.anthropic.com', model: 'claude-haiku-5-5' },
};

function toDraft(s: AdminAiSettings): Draft {
  return {
    enabled: s.enabled,
    provider: s.provider,
    baseUrl: s.baseUrl,
    model: s.model,
    apiKey: '',
    clearApiKey: false,
    temperature: s.temperature === null ? '' : String(s.temperature),
    maxTokens: s.maxTokens,
    timeoutSeconds: Math.round(s.timeoutMs / 1000),
    candidatePoolSize: s.candidatePoolSize,
    publicSearchEnabled: s.publicSearchEnabled,
    staffMatchingEnabled: s.staffMatchingEnabled,
    staffAssistantEnabled: s.staffAssistantEnabled,
    searchPrompt: s.searchPrompt ?? '',
    assistantPrompt: s.assistantPrompt ?? '',
  };
}

function Toggle({ id, checked, onChange, label, hint, disabled }: { id: string; checked: boolean; onChange: (v: boolean) => void; label: string; hint: string; disabled?: boolean }) {
  return (
    <label htmlFor={id} className={`flex items-start gap-3 py-2 text-sm ${disabled ? 'opacity-50' : ''}`}>
      <input id={id} type="checkbox" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} className="mt-0.5 h-4 w-4 rounded border-border text-brand focus:ring-brand" />
      <span>
        <span className="font-medium text-ink">{label}</span>
        <span className="block text-xs text-ink/50">{hint}</span>
      </span>
    </label>
  );
}

/**
 * Settings > AI: which model the AI features use and which features are on.
 * Off by default; Normal Search and every staff page work the same without it.
 */
export default function AiSettingsPage() {
  const { t } = useTranslation();
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: settings, isLoading } = useAiSettings();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const [testResult, setTestResult] = useState<AiTestResult | null>(null);

  useEffect(() => {
    if (settings) setDraft(toDraft(settings));
  }, [settings]);

  const save = useMutation({
    mutationFn: (d: Draft) => {
      const { apiKey, clearApiKey, timeoutSeconds, searchPrompt, assistantPrompt, temperature, ...rest } = d;
      return api.patch<AdminAiSettings>('/settings/ai', {
        ...rest,
        timeoutMs: timeoutSeconds * 1000,
        temperature: temperature.trim() === '' ? null : Number(temperature),
        searchPrompt: searchPrompt.trim() || null,
        assistantPrompt: assistantPrompt.trim() || null,
        // Write-only: sent only when typed, or when removing it.
        ...(apiKey.trim() ? { apiKey: apiKey.trim() } : {}),
        ...(clearApiKey ? { clearApiKey: true } : {}),
      });
    },
    onSuccess: (s) => {
      queryClient.setQueryData(['ai-settings'], s);
      queryClient.invalidateQueries({ queryKey: ['ai-status'] });
      setError(null);
      setSaved(true);
      setTimeout(() => setSaved(false), 3000);
    },
    onError: (err: unknown) => {
      setSaved(false);
      setError(err instanceof ApiError ? err.message : t('aiAdmin.saveError'));
    },
  });

  const test = useMutation({
    mutationFn: () => api.post<AiTestResult>('/settings/ai/test'),
    onSuccess: setTestResult,
    onError: (err: unknown) =>
      setTestResult({ ok: false, provider: draft!.provider, model: draft!.model, latencyMs: 0, toolCalling: false, message: err instanceof ApiError ? err.message : t('aiAdmin.saveError') }),
  });

  if (user?.role !== 'ADMIN' || isLoading || !draft || !settings) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setSaved(false);
    setDraft({ ...draft, [key]: value });
  };
  const setProvider = (provider: AiProvider) => {
    const wasDefault = (Object.values(DEFAULTS) as { baseUrl: string; model: string }[]);
    setSaved(false);
    setDraft({
      ...draft,
      provider,
      baseUrl: wasDefault.some((d) => d.baseUrl === draft.baseUrl) || !draft.baseUrl ? DEFAULTS[provider].baseUrl : draft.baseUrl,
      model: wasDefault.some((d) => d.model === draft.model) || !draft.model ? DEFAULTS[provider].model : draft.model,
    });
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(settings));
  const needsKey = draft.provider !== 'OLLAMA';

  return (
    <div className="max-w-3xl">
      <h2 className="mb-1 text-lg font-semibold text-ink">{t('aiAdmin.title')}</h2>
      <p className="mb-4 text-sm text-ink/60">{t('aiAdmin.subtitle')}</p>

      <div
        role="status"
        className={`mb-6 rounded-md border px-4 py-3 text-sm ${settings.enabled ? 'border-brand/30 bg-brand-light/40 text-brand-dark' : 'border-border bg-paper text-ink/70'}`}
      >
        {settings.enabled ? t('aiAdmin.statusOn', { model: settings.model }) : t('aiAdmin.statusOff')}
      </div>

      <div className="space-y-5">
        <Card>
          <CardHeader><CardTitle>{t('aiAdmin.featuresTitle')}</CardTitle></CardHeader>
          <CardContent>
            <Toggle id="enabled" checked={draft.enabled} onChange={(v) => set('enabled', v)} label={t('aiAdmin.enabled')} hint={t('aiAdmin.enabledHint')} />
            <div className="ml-7 border-l border-border pl-4">
              <Toggle id="publicSearch" disabled={!draft.enabled} checked={draft.publicSearchEnabled} onChange={(v) => set('publicSearchEnabled', v)} label={t('aiAdmin.publicSearch')} hint={t('aiAdmin.publicSearchHint')} />
              <Toggle id="staffMatching" disabled={!draft.enabled} checked={draft.staffMatchingEnabled} onChange={(v) => set('staffMatchingEnabled', v)} label={t('aiAdmin.staffMatching')} hint={t('aiAdmin.staffMatchingHint')} />
              <Toggle id="assistant" disabled={!draft.enabled} checked={draft.staffAssistantEnabled} onChange={(v) => set('staffAssistantEnabled', v)} label={t('aiAdmin.assistant')} hint={t('aiAdmin.assistantHint')} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('aiAdmin.modelTitle')}</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="provider">{t('aiAdmin.provider')}</Label>
              <Select id="provider" value={draft.provider} onChange={(e) => setProvider(e.target.value as AiProvider)}>
                <option value="OLLAMA">{t('aiAdmin.providerOllama')}</option>
                <option value="OPENAI_COMPATIBLE">{t('aiAdmin.providerOpenAi')}</option>
                <option value="ANTHROPIC">{t('aiAdmin.providerAnthropic')}</option>
              </Select>
            </div>
            <div>
              <Label htmlFor="model" required>{t('aiAdmin.model')}</Label>
              <Input id="model" autoComplete="off" value={draft.model} onChange={(e) => set('model', e.target.value)} />
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="baseUrl" required>{t('aiAdmin.baseUrl')}</Label>
              <Input id="baseUrl" autoComplete="off" value={draft.baseUrl} onChange={(e) => set('baseUrl', e.target.value)} />
              <p className="mt-1 text-xs text-ink/50">{t(`aiAdmin.baseUrlHint.${draft.provider}`)}</p>
            </div>
            <div className="sm:col-span-2">
              <Label htmlFor="apiKey" required={needsKey && !settings.apiKeySet}>{t('aiAdmin.apiKey')}</Label>
              <Input
                id="apiKey"
                type="password"
                autoComplete="new-password"
                placeholder={settings.apiKeySet && !draft.clearApiKey ? t('aiAdmin.apiKeyKeep', { hint: settings.apiKeyHint ?? '' }) : ''}
                value={draft.apiKey}
                onChange={(e) => setDraft({ ...draft, apiKey: e.target.value, clearApiKey: false })}
              />
              <p className="mt-1 text-xs text-ink/50">{needsKey ? t('aiAdmin.apiKeyHint') : t('aiAdmin.apiKeyHintOllama')}</p>
              {settings.apiKeySet && (
                <label className="mt-2 flex items-center gap-2 text-xs text-ink/70">
                  <input type="checkbox" checked={draft.clearApiKey} onChange={(e) => setDraft({ ...draft, clearApiKey: e.target.checked, apiKey: '' })} className="h-3.5 w-3.5 rounded border-border text-brand focus:ring-brand" />
                  {t('aiAdmin.apiKeyRemove')}
                </label>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('aiAdmin.tuningTitle')}</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div>
              <Label htmlFor="temperature">{t('aiAdmin.temperature')}</Label>
              <Input id="temperature" type="number" min={0} max={1} step={0.05} placeholder={t('aiAdmin.temperatureDefault')} value={draft.temperature} onChange={(e) => set('temperature', e.target.value)} />
              <p className="mt-1 text-xs text-ink/50">{t('aiAdmin.temperatureHint')}</p>
            </div>
            <div>
              <Label htmlFor="maxTokens">{t('aiAdmin.maxTokens')}</Label>
              <Input id="maxTokens" type="number" min={256} max={8192} step={128} value={draft.maxTokens} onChange={(e) => set('maxTokens', Number(e.target.value))} />
            </div>
            <div>
              <Label htmlFor="timeout">{t('aiAdmin.timeout')}</Label>
              <Input id="timeout" type="number" min={3} max={120} value={draft.timeoutSeconds} onChange={(e) => set('timeoutSeconds', Number(e.target.value))} />
              <p className="mt-1 text-xs text-ink/50">{t('aiAdmin.timeoutHint')}</p>
            </div>
            <div>
              <Label htmlFor="pool">{t('aiAdmin.pool')}</Label>
              <Input id="pool" type="number" min={5} max={50} value={draft.candidatePoolSize} onChange={(e) => set('candidatePoolSize', Number(e.target.value))} />
              <p className="mt-1 text-xs text-ink/50">{t('aiAdmin.poolHint')}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('aiAdmin.promptsTitle')}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs text-ink/50">{t('aiAdmin.promptsHint')}</p>
            <div>
              <Label htmlFor="searchPrompt">{t('aiAdmin.searchPrompt')}</Label>
              <Textarea id="searchPrompt" rows={3} maxLength={4000} value={draft.searchPrompt} onChange={(e) => set('searchPrompt', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="assistantPrompt">{t('aiAdmin.assistantPrompt')}</Label>
              <Textarea id="assistantPrompt" rows={3} maxLength={4000} value={draft.assistantPrompt} onChange={(e) => set('assistantPrompt', e.target.value)} />
            </div>
          </CardContent>
        </Card>

        <div className="rounded-md border border-border bg-paper px-4 py-3 text-xs text-ink/70">
          <p className="font-semibold text-ink">{t('aiAdmin.privacyTitle')}</p>
          <p className="mt-1">{t('aiAdmin.privacy')}</p>
        </div>

        {error && <p className="text-sm text-danger">{error}</p>}
        <div className="flex items-center gap-3">
          <Button onClick={() => save.mutate(draft)} disabled={save.isPending || !dirty}>
            {save.isPending ? t('common.loading') : t('common.save')}
          </Button>
          {saved && <span className="text-sm text-brand-dark">{t('aiAdmin.saved')}</span>}
        </div>

        <Card>
          <CardHeader><CardTitle>{t('aiAdmin.testTitle')}</CardTitle></CardHeader>
          <CardContent>
            <p className="mb-3 text-xs text-ink/50">{t('aiAdmin.testHint')}</p>
            <Button variant="secondary" onClick={() => { setTestResult(null); test.mutate(); }} disabled={test.isPending || dirty}>
              {test.isPending ? t('aiAdmin.testRunning') : t('aiAdmin.testRun')}
            </Button>
            {dirty && <p className="mt-2 text-xs text-ink/50">{t('aiAdmin.testSaveFirst')}</p>}
            {testResult && (
              <div className={`mt-3 text-sm ${testResult.ok ? 'text-brand-dark' : 'text-danger'}`}>
                <p>{testResult.ok ? t('aiAdmin.testOk', { ms: testResult.latencyMs }) : t('aiAdmin.testFailed')}</p>
                {testResult.ok && (
                  <p className={testResult.toolCalling ? 'text-brand-dark' : 'text-danger'}>
                    {testResult.toolCalling ? t('aiAdmin.testTools') : t('aiAdmin.testNoTools')}
                  </p>
                )}
                <p className="mt-1 break-words text-xs text-ink/60">{testResult.message}</p>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
