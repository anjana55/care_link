'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ACTION_LIMITS,
  AUTOMATION_MODES,
  BUILT_AGENTS,
  type AgentRunResult,
  type AutomationFunction,
  type AutomationActionStatus,
  type AutomationFunctionStatus,
  type AutomationMode,
  type AutomationOverview,
  type PromotionBar,
} from '@care-platform/shared';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { fmtDateTime } from '@/lib/colombo-time';
import { cn } from '@/lib/utils';
import {
  useAutomationOverview,
  useResetAutomationTrip,
  useRetryJob,
  useRunAgent,
  useSetActionPolicy,
  useSetAutomationMode,
  useSetFunctionEndpoints,
  useSetMasterSwitch,
  useUpdatePromotionBar,
} from '@/lib/hooks/use-automation';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { Input, Label, Select } from '@/components/ui/input';
import { EndpointsCard } from '@/components/automation/endpoints-card';

type Confirm =
  | { kind: 'master'; on: boolean }
  | { kind: 'auto'; fn: AutomationFunctionStatus }
  | { kind: 'reset'; fn: AutomationFunctionStatus };

const TIER_STYLES = ['bg-ink/10 text-ink/70', 'bg-brand-light text-brand-dark', 'bg-accent-light text-accent', 'bg-danger-light text-danger'];
const BAR_LIMITS = { cases: [10, 1000], agreementPercent: [50, 100], demoteAfterReversals: [1, 20] } as const;

/**
 * Settings > Automation (admin): the master switch, one dial per agent, trip
 * resets, and which commitments have earned acting without approval.
 *
 * Every control here only narrows or widens what an agent may do; none of them
 * cancels anything in progress. Moving a dial up to Auto and the master
 * switch ask for confirmation; moving a dial down never does, so going back
 * to manual is always one click.
 */
export default function AutomationSettingsPage() {
  const { t, locale } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const isAdmin = user?.role === 'ADMIN';
  const { data, isLoading } = useAutomationOverview(isAdmin);
  const setMaster = useSetMasterSwitch();
  const setMode = useSetAutomationMode();
  const resetTrip = useResetAutomationTrip();
  const setEndpoints = useSetFunctionEndpoints();
  const retryJob = useRetryJob();
  const runAgent = useRunAgent();
  const [ran, setRan] = useState<Partial<Record<AutomationFunction, AgentRunResult>>>({});
  const setPolicy = useSetActionPolicy();
  const updateBar = useUpdatePromotionBar();

  const [confirm, setConfirm] = useState<Confirm | null>(null);
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState<Record<string, boolean>>({});

  useEffect(() => {
    if (authLoading) return;
    if (user && !isAdmin) router.replace('/dashboard');
  }, [authLoading, user, isAdmin, router]);

  if (authLoading || !user || !isAdmin || isLoading || !data) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;
  }

  const fail = (err: unknown) => setError(err instanceof ApiError && err.message ? err.message : t('automation.saveError'));
  const done = { onSuccess: () => (setConfirm(null), setReason(''), setError(null)), onError: fail };
  const locked = data.disabledByServer;
  const pending = setMaster.isPending || setMode.isPending || resetTrip.isPending;

  const chooseMode = (fn: AutomationFunctionStatus, mode: AutomationMode) => {
    if (mode === fn.mode) return;
    setError(null);
    if (mode === 'AUTO') setConfirm({ kind: 'auto', fn });
    else setMode.mutate({ key: fn.key, mode }, { onError: fail });
  };

  const runConfirm = () => {
    if (!confirm) return;
    if (confirm.kind === 'master') setMaster.mutate({ on: confirm.on, reason: reason.trim() || undefined }, done);
    else if (confirm.kind === 'auto') setMode.mutate({ key: confirm.fn.key, mode: 'AUTO' }, done);
    else resetTrip.mutate({ key: confirm.fn.key }, done);
  };

  const when = (iso: string) => fmtDateTime(iso, locale);

  const actionRow = (a: AutomationActionStatus) => (
    <li key={a.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 border-t border-border py-2 first:border-t-0">
      <span className="min-w-0 flex-1 basis-64 text-sm text-ink">{a.label}</span>
      <span className={cn('rounded px-2 py-0.5 text-xs font-medium', TIER_STYLES[a.tier])}>{t(`automation.tiers.${a.tier}`)}</span>
      <span className="basis-56 text-xs text-ink/60">
        {a.record.judged
          ? t('automation.record', { agreed: a.record.agreed, judged: a.record.judged, percent: a.agreementPercent ?? 0 })
          : t('automation.noRecord')}
        {a.record.serious > 0 && <span className="ml-1 text-danger">· {t('automation.recordSerious', { n: a.record.serious })}</span>}
      </span>
      {ACTION_LIMITS[a.key] && <ActionLimit action={a} disabled={setPolicy.isPending} onSave={(limits) => setPolicy.mutate({ action: a.key, limits }, { onError: fail })} />}
      {a.tier === 2 && (
        <span className="flex basis-full flex-wrap items-center gap-2 sm:basis-auto">
          {a.autoAllowed ? (
            <>
              <span className="text-xs font-medium text-brand-dark">{t('automation.actsAlone')}</span>
              <Button size="sm" variant="secondary" disabled={setPolicy.isPending} onClick={() => setPolicy.mutate({ action: a.key, autoAllowed: false }, { onError: fail })}>
                {t('automation.withdraw')}
              </Button>
            </>
          ) : a.eligibleForAuto ? (
            <Button size="sm" disabled={setPolicy.isPending || locked} onClick={() => setPolicy.mutate({ action: a.key, autoAllowed: true }, { onError: fail })}>
              {t('automation.allow')}
            </Button>
          ) : (
            <span className="text-xs text-ink/50">{t('automation.notEarned')}</span>
          )}
          {a.record.serious > 0 && !a.autoAllowed && (
            <Button size="sm" variant="ghost" disabled={setPolicy.isPending} onClick={() => setPolicy.mutate({ action: a.key, resetRecord: true }, { onError: fail })}>
              {t('automation.resetRecord')}
            </Button>
          )}
        </span>
      )}
    </li>
  );

  const functionCard = (fn: AutomationFunctionStatus) => {
    const heldManual = fn.mode !== 'MANUAL' && fn.effectiveMode === 'MANUAL';
    return (
      <Card key={fn.key}>
        <CardContent className="space-y-3 pt-5">
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-ink">{t(`automation.functions.${fn.key}.name`)}</h3>
              <p className="text-xs text-ink/60">{t(`automation.functions.${fn.key}.desc`)}</p>
            </div>
            {heldManual && <span className="rounded bg-accent-light px-2 py-0.5 text-xs font-medium text-accent">{t('automation.manualNow')}</span>}
          </div>

          {fn.trippedAt && (
            <div role="alert" className="flex flex-wrap items-center justify-between gap-2 rounded bg-danger-light px-3 py-2 text-sm text-danger">
              <span>
                {t('automation.tripped', { when: when(fn.trippedAt) })}
                {fn.tripReason && <span className="block text-xs">{t('automation.master.reasonGiven', { reason: fn.tripReason })}</span>}
              </span>
              <Button size="sm" variant="secondary" disabled={pending} onClick={() => (setError(null), setConfirm({ kind: 'reset', fn }))}>
                {t('automation.reset')}
              </Button>
            </div>
          )}

          <fieldset disabled={locked || Boolean(fn.trippedAt) || setMode.isPending}>
            <legend className="mb-1 text-xs font-medium text-ink/70">{t('automation.dial')}</legend>
            <div className="inline-flex flex-wrap overflow-hidden rounded border border-border">
              {AUTOMATION_MODES.map((mode) => (
                <button
                  key={mode}
                  type="button"
                  aria-pressed={fn.mode === mode}
                  onClick={() => chooseMode(fn, mode)}
                  className={cn(
                    'h-9 min-w-[5.5rem] border-r border-border px-3 text-sm last:border-r-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand disabled:opacity-60',
                    fn.mode === mode ? 'bg-brand font-medium text-white' : 'bg-white text-ink hover:bg-paper',
                  )}
                >
                  {t(`automation.modes.${mode}.name`)}
                </button>
              ))}
            </div>
            <p className="mt-1 text-xs text-ink/60">{t(`automation.modes.${fn.mode}.hint`)}</p>
          </fieldset>

          {data.endpoints.length > 0 && (
            <div className="flex flex-wrap gap-4">
              {(['endpointId', 'fallbackEndpointId'] as const).map((field) => (
                <div key={field} className="w-56">
                  <Label htmlFor={`${fn.key}-${field}`}>{t(field === 'endpointId' ? 'automation.models.main' : 'automation.models.backup')}</Label>
                  <Select
                    id={`${fn.key}-${field}`}
                    value={fn[field] ?? ''}
                    disabled={setEndpoints.isPending}
                    onChange={(e) => (setError(null), setEndpoints.mutate({ key: fn.key, [field]: e.target.value || null }, { onError: fail }))}
                  >
                    <option value="">{t('automation.models.noModel')}</option>
                    {data.endpoints.map((e) => (
                      <option key={e.id} value={e.id}>
                        {e.name} ({t(`automation.models.classes.${e.clearedFor}`)})
                      </option>
                    ))}
                  </Select>
                </div>
              ))}
            </div>
          )}

          {!BUILT_AGENTS.includes(fn.key) ? (
            <p className="rounded bg-paper px-3 py-2 text-xs text-ink/60">{t('automation.run.notBuilt')}</p>
          ) : (
            fn.effectiveMode !== 'MANUAL' && (
              <div className="flex flex-wrap items-center gap-3">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={runAgent.isPending}
                  onClick={() => (setError(null), runAgent.mutate(fn.key, { onSuccess: (r) => setRan((prev) => ({ ...prev, [fn.key]: r })), onError: fail }))}
                >
                  {runAgent.isPending && runAgent.variables === fn.key ? t('automation.run.running') : t('automation.run.button')}
                </Button>
                {ran[fn.key] && (
                  <span role="status" className="text-xs text-ink/70">
                    {t('automation.run.result', { considered: ran[fn.key]!.considered, decided: ran[fn.key]!.decided, scored: ran[fn.key]!.scored, leftToStaff: ran[fn.key]!.leftToStaff })}
                  </span>
                )}
              </div>
            )
          )}

          <p className="text-xs text-ink/60">
            {t('automation.recent', { executed: fn.recent.EXECUTED, proposed: fn.recent.PROPOSED, shadow: fn.recent.SHADOW })}
            {fn.awaitingStaff > 0 && <span className="ml-2 font-medium text-accent">· {t('automation.awaiting', { n: fn.awaitingStaff })}</span>}
          </p>

          <div>
            <button
              type="button"
              aria-expanded={Boolean(open[fn.key])}
              onClick={() => setOpen({ ...open, [fn.key]: !open[fn.key] })}
              className="text-sm font-medium text-brand-dark underline-offset-2 hover:underline"
            >
              {open[fn.key] ? t('automation.hideActions') : t('automation.showActions', { n: fn.actions.length })}
            </button>
            {open[fn.key] && <ul className="mt-2">{fn.actions.map(actionRow)}</ul>}
          </div>
        </CardContent>
      </Card>
    );
  };

  return (
    <div className="max-w-4xl">
      <h2 className="mb-1 text-lg font-semibold text-ink">{t('automation.title')}</h2>
      <p className="mb-4 text-sm text-ink/60">{t('automation.subtitle')}</p>

      {locked && (
        <p role="alert" className="mb-4 rounded bg-accent-light px-3 py-2 text-sm text-accent">
          {t('automation.serverDisabled')}
        </p>
      )}
      {error && !confirm && (
        <p role="alert" className="mb-4 rounded bg-danger-light px-3 py-2 text-sm text-danger">
          {error}
        </p>
      )}

      <Card className={cn('mb-4', data.masterManual && 'border-danger')}>
        <CardContent className="flex flex-wrap items-center justify-between gap-3 pt-5">
          <div className="min-w-0 flex-1 basis-72">
            <h3 className="text-sm font-semibold text-ink">{t('automation.master.title')}</h3>
            <p className="text-sm text-ink/70">{data.masterManual ? t('automation.master.onText') : t('automation.master.offText')}</p>
            {data.masterManual && (
              <p className="mt-1 text-xs text-ink/60">
                {data.masterAt && t('automation.master.since', { when: when(data.masterAt) })}
                {data.masterReason && <span className="ml-1">· {t('automation.master.reasonGiven', { reason: data.masterReason })}</span>}
              </p>
            )}
            {data.casesTakenOver > 0 && <p className="mt-1 text-xs text-ink/60">{t('automation.takenOver', { n: data.casesTakenOver })}</p>}
          </div>
          {data.masterManual ? (
            <Button variant="secondary" disabled={pending || locked} onClick={() => (setError(null), setConfirm({ kind: 'master', on: false }))}>
              {t('automation.master.switchBack')}
            </Button>
          ) : (
            <Button variant="danger" disabled={pending} onClick={() => (setError(null), setConfirm({ kind: 'master', on: true }))}>
              {t('automation.master.switchManual')}
            </Button>
          )}
        </CardContent>
      </Card>

      <div className="space-y-4">{data.functions.map(functionCard)}</div>

      <EndpointsCard overview={data} />

      <Card className="mt-4">
        <CardContent className="space-y-2 pt-5">
          <div>
            <h3 className="text-sm font-semibold text-ink">{t('automation.jobs.title')}</h3>
            <p className="text-xs text-ink/60">{t('automation.jobs.hint')}</p>
          </div>
          <p className="text-sm text-ink">{t('automation.jobs.counts', { pending: data.jobs.pending, running: data.jobs.running, failed: data.jobs.failed })}</p>
          {(data.jobs.oldestDueMinutes ?? 0) >= 5 && (
            <p role="alert" className="rounded bg-accent-light px-3 py-2 text-sm text-accent">
              {t('automation.jobs.late', { minutes: data.jobs.oldestDueMinutes ?? 0 })}
            </p>
          )}
          {data.jobs.recentFailures.length > 0 && (
            <ul>
              {data.jobs.recentFailures.map((j) => (
                <li key={j.id} className="flex flex-wrap items-center justify-between gap-2 border-t border-border py-2 text-sm first:border-t-0">
                  <span className="min-w-0">
                    <span className="font-medium text-ink">{j.type}</span>
                    {j.finishedAt && <span className="ml-2 text-xs tabular-nums text-ink/50">{when(j.finishedAt)}</span>}
                    <span className="block text-xs text-danger">{j.lastError ?? t('automation.jobs.noError')}</span>
                  </span>
                  <Button size="sm" variant="secondary" disabled={retryJob.isPending} onClick={() => retryJob.mutate({ id: j.id }, { onError: fail })}>
                    {t('automation.jobs.retry')}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <PromotionBarCard overview={data} save={updateBar} />

      {confirm?.kind === 'master' && (
        <ConfirmDialog
          title={t(confirm.on ? 'automation.master.confirmTitle' : 'automation.master.confirmBackTitle')}
          message={t(confirm.on ? 'automation.master.confirmMessage' : 'automation.master.confirmBackMessage')}
          confirmLabel={t(confirm.on ? 'automation.master.switchManual' : 'automation.master.switchBack')}
          tone={confirm.on ? 'danger' : 'primary'}
          pending={setMaster.isPending}
          error={error}
          onConfirm={runConfirm}
          onCancel={() => (setConfirm(null), setError(null))}
        >
          {confirm.on && (
            <div className="mb-4">
              <Label htmlFor="master-reason">{t('automation.master.reason')}</Label>
              <Input id="master-reason" value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} />
            </div>
          )}
        </ConfirmDialog>
      )}
      {confirm?.kind === 'auto' && (
        <ConfirmDialog
          title={t('automation.confirmAutoTitle')}
          message={`${t(`automation.functions.${confirm.fn.key}.name`)}: ${t('automation.confirmAutoMessage')}`}
          confirmLabel={t('automation.modes.AUTO.name')}
          pending={setMode.isPending}
          error={error}
          onConfirm={runConfirm}
          onCancel={() => (setConfirm(null), setError(null))}
        />
      )}
      {confirm?.kind === 'reset' && (
        <ConfirmDialog
          title={t('automation.resetTitle')}
          message={t('automation.resetMessage', { mode: t(`automation.modes.${confirm.fn.mode}.name`) })}
          confirmLabel={t('automation.reset')}
          pending={resetTrip.isPending}
          error={error}
          onConfirm={runConfirm}
          onCancel={() => (setConfirm(null), setError(null))}
        />
      )}
    </div>
  );
}

/** The admin's limit for one action (an amount in LKR), with the default shown while none is set. */
function ActionLimit({ action, disabled, onSave }: { action: AutomationActionStatus; disabled: boolean; onSave: (limits: Record<string, number>) => void }) {
  const { t } = useTranslation();
  const def = ACTION_LIMITS[action.key]!;
  const current = action.limits?.[def.key];
  const [value, setValue] = useState(current === undefined ? '' : String(current));
  const n = Number(value);
  const bad = value.trim() === '' || !/^\d+(\.\d{1,2})?$/.test(value.trim()) || n < def.min || n > def.max;
  const id = `limit-${action.key}`;
  return (
    <span className="flex basis-full flex-wrap items-end gap-2">
      <span>
        <Label htmlFor={id}>{t('automation.limit')}</Label>
        <Input id={id} inputMode="decimal" className="h-8 w-36" value={value} placeholder={String(def.default)} aria-describedby={`${id}-hint`} onChange={(e) => setValue(e.target.value)} />
      </span>
      <Button size="sm" variant="secondary" disabled={disabled || bad || n === current} onClick={() => onSave({ [def.key]: n })}>
        {t('automation.limitSave')}
      </Button>
      {current === undefined && (
        <span id={`${id}-hint`} className="pb-1.5 text-xs text-ink/50">
          {t('automation.limitDefault', { amount: def.default.toLocaleString('en-LK') })}
        </span>
      )}
    </span>
  );
}

/** The promotion bar: three numbers, saved together. */
function PromotionBarCard({ overview, save }: { overview: AutomationOverview; save: ReturnType<typeof useUpdatePromotionBar> }) {
  const { t } = useTranslation();
  const toDraft = (b: PromotionBar) => ({ cases: String(b.cases), agreementPercent: String(b.agreementPercent), demoteAfterReversals: String(b.demoteAfterReversals) });
  const [draft, setDraft] = useState(() => toDraft(overview.bar));
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<string | null>(null);

  type Field = keyof typeof BAR_LIMITS;
  const bad = (f: Field) => !/^\d+$/.test(draft[f]) || Number(draft[f]) < BAR_LIMITS[f][0] || Number(draft[f]) > BAR_LIMITS[f][1];
  const anyBad = bad('cases') || bad('agreementPercent') || bad('demoteAfterReversals');

  const field = (f: Field, label: string, hint: string) => (
    <div>
      <Label htmlFor={`bar-${f}`}>{label}</Label>
      <Input
        id={`bar-${f}`}
        inputMode="numeric"
        value={draft[f]}
        aria-invalid={bad(f)}
        aria-describedby={`bar-${f}-hint`}
        onChange={(e) => (setSaved(false), setError(null), setDraft({ ...draft, [f]: e.target.value }))}
        className="max-w-[8rem]"
      />
      <p id={`bar-${f}-hint`} className={`mt-1 text-xs ${bad(f) ? 'text-danger' : 'text-ink/50'}`}>
        {hint}
      </p>
    </div>
  );

  const submit = () =>
    save.mutate(
      { cases: Number(draft.cases), agreementPercent: Number(draft.agreementPercent), demoteAfterReversals: Number(draft.demoteAfterReversals) },
      {
        onSuccess: (data) => {
          setDraft(toDraft(data.bar));
          setSaved(true);
          setTimeout(() => setSaved(false), 3000);
        },
        onError: (err) => setError(err instanceof ApiError && err.message ? err.message : t('automation.saveError')),
      },
    );

  return (
    <Card className="mt-4">
      <CardContent className="space-y-4 pt-5">
        <div>
          <h3 className="text-sm font-semibold text-ink">{t('automation.bar.title')}</h3>
          <p className="text-xs text-ink/60">{t('automation.bar.hint')}</p>
        </div>
        <div className="flex flex-wrap gap-6">
          {field('cases', t('automation.bar.cases'), t('automation.bar.casesHint'))}
          {field('agreementPercent', t('automation.bar.agreement'), t('automation.bar.agreementHint'))}
          {field('demoteAfterReversals', t('automation.bar.reversals'), t('automation.bar.reversalsHint'))}
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
        <div className="flex items-center gap-3">
          <Button onClick={submit} disabled={save.isPending || anyBad}>
            {save.isPending ? t('common.loading') : t('common.save')}
          </Button>
          {saved && (
            <span role="status" className="text-sm text-brand-dark">
              {t('automation.saved')}
            </span>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
