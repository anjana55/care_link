'use client';

import { useState } from 'react';
import {
  DATA_CLASSES,
  aiProviderValues,
  type AiProvider,
  type AutomationEndpoint,
  type AutomationEndpointInput,
  type AutomationOverview,
  type DataClass,
} from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { cn } from '@/lib/utils';
import { useDeleteEndpoint, useSaveEndpoint, useTestEndpoint } from '@/lib/hooks/use-automation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input, Label, Select } from '@/components/ui/input';

const CLASS_STYLES: Record<DataClass, string> = {
  PUBLIC: 'bg-ink/10 text-ink/70',
  PERSONAL: 'bg-accent-light text-accent',
  SENSITIVE: 'bg-danger-light text-danger',
};
const DEFAULT_URLS: Record<AiProvider, string> = {
  OLLAMA: 'http://localhost:11434',
  OPENAI_COMPATIBLE: 'https://api.openai.com/v1',
  ANTHROPIC: 'https://api.anthropic.com',
};

interface Draft {
  id?: string;
  name: string;
  provider: AiProvider;
  baseUrl: string;
  model: string;
  apiKey: string;
  clearedFor: DataClass;
  enabled: boolean;
  apiKeyHint: string | null;
}

const blank: Draft = { name: '', provider: 'OLLAMA', baseUrl: DEFAULT_URLS.OLLAMA, model: '', apiKey: '', clearedFor: 'PUBLIC', enabled: true, apiKeyHint: null };

/**
 * Settings > Automation > AI models: the models agents may use, each with
 * the most sensitive kind of data it may be sent. A new model starts at
 * "public data only"; raising that is a deliberate choice in the form.
 */
export function EndpointsCard({ overview }: { overview: AutomationOverview }) {
  const { t } = useTranslation();
  const save = useSaveEndpoint();
  const remove = useDeleteEndpoint();
  const test = useTestEndpoint();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [deleting, setDeleting] = useState<AutomationEndpoint | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tested, setTested] = useState<Record<string, { ok: boolean; text: string }>>({});

  const message = (err: unknown) => (err instanceof ApiError && err.message ? err.message : t('automation.saveError'));
  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => draft && (setError(null), setDraft({ ...draft, [key]: value }));

  const submit = () => {
    if (!draft) return;
    const input: AutomationEndpointInput = {
      name: draft.name,
      provider: draft.provider,
      baseUrl: draft.baseUrl,
      model: draft.model,
      clearedFor: draft.clearedFor,
      enabled: draft.enabled,
      ...(draft.apiKey.trim() && { apiKey: draft.apiKey.trim() }),
    };
    save.mutate({ id: draft.id, input }, { onSuccess: () => (setDraft(null), setError(null)), onError: (e) => setError(message(e)) });
  };

  const runTest = (e: AutomationEndpoint) =>
    test.mutate(e.id, {
      onSuccess: (r) => setTested((prev) => ({ ...prev, [e.id]: { ok: r.ok, text: r.ok ? t('automation.models.testOk', { ms: r.latencyMs }) : r.message } })),
      onError: (err) => setTested((prev) => ({ ...prev, [e.id]: { ok: false, text: message(err) } })),
    });

  const copyDefault = () =>
    save.mutate({ input: { name: t('automation.models.copyName'), copyDefault: true } }, { onError: (e) => setError(message(e)) });

  return (
    <Card className="mt-4">
      <CardContent className="space-y-3 pt-5">
        <div>
          <h3 className="text-sm font-semibold text-ink">{t('automation.models.title')}</h3>
          <p className="text-xs text-ink/60">{t('automation.models.hint')}</p>
        </div>

        {overview.endpoints.length === 0 ? (
          <p className="text-sm text-ink/60">{t('automation.models.none')}</p>
        ) : (
          <ul>
            {overview.endpoints.map((e) => (
              <li key={e.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border py-2 first:border-t-0">
                <div className="min-w-0 flex-1 basis-64">
                  <p className="text-sm font-medium text-ink">
                    {e.name}
                    {!e.enabled && <span className="ml-2 text-xs font-normal text-ink/50">{t('automation.models.off')}</span>}
                  </p>
                  <p className="truncate text-xs text-ink/60">
                    {t(`automation.models.providers.${e.provider}`)} · {e.model} · {e.baseUrl}
                  </p>
                  <p className="text-xs text-ink/50">
                    {e.usedBy.length
                      ? t('automation.models.usedBy', { list: e.usedBy.map((k) => t(`automation.functions.${k}.name`)).join(', ') })
                      : t('automation.models.unused')}
                  </p>
                  {tested[e.id] && (
                    <p role="status" className={cn('text-xs', tested[e.id].ok ? 'text-brand-dark' : 'text-danger')}>
                      {tested[e.id].text}
                    </p>
                  )}
                </div>
                <span className={cn('rounded px-2 py-0.5 text-xs font-medium', CLASS_STYLES[e.clearedFor])}>{t(`automation.models.classes.${e.clearedFor}`)}</span>
                <span className="flex gap-2">
                  <Button size="sm" variant="secondary" disabled={test.isPending} onClick={() => runTest(e)}>
                    {test.isPending && test.variables === e.id ? t('automation.models.testing') : t('automation.models.test')}
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    onClick={() => (setError(null), setDraft({ id: e.id, name: e.name, provider: e.provider, baseUrl: e.baseUrl, model: e.model, apiKey: '', clearedFor: e.clearedFor, enabled: e.enabled, apiKeyHint: e.apiKeyHint }))}
                  >
                    {t('automation.models.edit')}
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => (setError(null), setDeleting(e))}>
                    {t('automation.models.delete')}
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        )}

        {error && !draft && !deleting && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}

        <div className="flex flex-wrap gap-2">
          <Button size="sm" onClick={() => (setError(null), setDraft(blank))}>
            {t('automation.models.add')}
          </Button>
          <Button size="sm" variant="secondary" disabled={save.isPending} onClick={copyDefault}>
            {t('automation.models.copyDefault')}
          </Button>
        </div>
      </CardContent>

      {draft && (
        <ConfirmDialog
          title={t(draft.id ? 'automation.models.form.editTitle' : 'automation.models.form.addTitle')}
          confirmLabel={t('automation.models.form.save')}
          pending={save.isPending}
          error={error}
          onConfirm={submit}
          onCancel={() => (setDraft(null), setError(null))}
        >
          <div className="mb-4 space-y-3 text-left">
            <div>
              <Label htmlFor="ep-name">{t('automation.models.form.name')}</Label>
              <Input id="ep-name" value={draft.name} maxLength={80} onChange={(e) => set('name', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ep-provider">{t('automation.models.form.provider')}</Label>
              <Select
                id="ep-provider"
                value={draft.provider}
                onChange={(e) => {
                  const provider = e.target.value as AiProvider;
                  // Swap the address only if it is still another provider's default.
                  const untouched = Object.values(DEFAULT_URLS).includes(draft.baseUrl);
                  setError(null);
                  setDraft({ ...draft, provider, baseUrl: untouched ? DEFAULT_URLS[provider] : draft.baseUrl });
                }}
              >
                {aiProviderValues.map((p) => (
                  <option key={p} value={p}>
                    {t(`automation.models.providers.${p}`)}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="ep-url">{t('automation.models.form.baseUrl')}</Label>
              <Input id="ep-url" value={draft.baseUrl} maxLength={255} onChange={(e) => set('baseUrl', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="ep-model">{t('automation.models.form.model')}</Label>
              <Input id="ep-model" value={draft.model} maxLength={120} onChange={(e) => set('model', e.target.value)} />
            </div>
            {draft.provider !== 'OLLAMA' && (
              <div>
                <Label htmlFor="ep-key">{t('automation.models.form.apiKey')}</Label>
                <Input id="ep-key" type="password" autoComplete="off" value={draft.apiKey} onChange={(e) => set('apiKey', e.target.value)} aria-describedby="ep-key-hint" />
                {draft.apiKeyHint && (
                  <p id="ep-key-hint" className="mt-1 text-xs text-ink/50">
                    {t('automation.models.form.apiKeyKeep', { hint: draft.apiKeyHint })}
                  </p>
                )}
              </div>
            )}
            <div>
              <Label htmlFor="ep-class">{t('automation.models.form.clearedFor')}</Label>
              <Select id="ep-class" value={draft.clearedFor} onChange={(e) => set('clearedFor', e.target.value as DataClass)} aria-describedby="ep-class-hint">
                {DATA_CLASSES.map((c) => (
                  <option key={c} value={c}>
                    {t(`automation.models.classes.${c}`)}
                  </option>
                ))}
              </Select>
              <p id="ep-class-hint" className={cn('mt-1 text-xs', draft.clearedFor === 'SENSITIVE' ? 'text-danger' : 'text-ink/60')}>
                {t(`automation.models.classHints.${draft.clearedFor}`)}
              </p>
            </div>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="checkbox" className="h-4 w-4 accent-brand" checked={draft.enabled} onChange={(e) => set('enabled', e.target.checked)} />
              {t('automation.models.form.enabled')}
            </label>
          </div>
        </ConfirmDialog>
      )}

      {deleting && (
        <ConfirmDialog
          title={t('automation.models.deleteTitle')}
          message={t('automation.models.deleteMessage', { name: deleting.name })}
          confirmLabel={t('automation.models.delete')}
          tone="danger"
          pending={remove.isPending}
          error={error}
          onConfirm={() => remove.mutate({ id: deleting.id }, { onSuccess: () => (setDeleting(null), setError(null)), onError: (e) => setError(message(e)) })}
          onCancel={() => (setDeleting(null), setError(null))}
        />
      )}
    </Card>
  );
}
