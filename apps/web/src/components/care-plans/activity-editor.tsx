'use client';

import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import {
  ALL_WEEKDAYS,
  careActivityCategoryValues,
  careActivityProblems,
  careActivityTimingValues,
  careSlotValues,
  isValidTime,
  type CareActivityFields,
  type IsoWeekday,
  type Locale,
} from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { fmtWeekday } from '@/lib/colombo-time';
import { Button } from '@/components/ui/button';
import { Input, Select, Textarea } from '@/components/ui/input';
import { cn } from '@/lib/utils';

/** An activity being edited: the fields, the id it keeps (plans), and the times as typed. */
export interface DraftActivity extends CareActivityFields {
  id?: string;
  /** Stable React key - an id is not there for new rows. */
  key: string;
  timesText: string;
}

let seq = 0;
const nextKey = () => `a${Date.now().toString(36)}${(seq++).toString(36)}`;

export const toDraft = (a: CareActivityFields & { id?: string }): DraftActivity => ({
  ...a,
  instructions: a.instructions ?? {},
  key: a.id ?? nextKey(),
  timesText: (a.times ?? []).join(', '),
});

export const blankDraft = (): DraftActivity => ({
  key: nextKey(),
  category: 'PERSONAL_CARE',
  title: {},
  instructions: {},
  timing: 'ANY',
  slot: null,
  times: [],
  timesText: '',
  daysOfWeek: null,
  isCritical: false,
});

const parseTimes = (text: string) =>
  text
    .split(/[\s,;]+/)
    .map((t) => t.trim())
    .filter(Boolean)
    .map((t) => (/^\d:\d\d$/.test(t) ? `0${t}` : t));

/** What is sent to the API: times from the typed text, nothing the timing does not use. */
export function fromDraft(d: DraftActivity): CareActivityFields & { id?: string } {
  const { key: _key, timesText, ...rest } = d;
  return { ...rest, times: d.timing === 'AT_TIMES' ? parseTimes(timesText) : [], slot: d.timing === 'SLOT' ? d.slot : null };
}

/** The first problem with each draft (by key), as an i18n key under carePlans.problem. */
export function draftProblems(list: DraftActivity[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const d of list) {
    const f = fromDraft(d);
    const bad = f.timing === 'AT_TIMES' && f.times.some((t) => !isValidTime(t)) ? 'times' : careActivityProblems(f)[0];
    if (bad) out[d.key] = bad;
  }
  return out;
}

/**
 * The list of activities on a template or a plan: what, when in the shift,
 * which days, whether it is critical, and the words in each language the
 * deployment offers. Shared by the template editor and the booking's plan.
 */
export function ActivityEditor({
  value,
  onChange,
  textLocale,
  onTextLocaleChange,
  problems,
}: {
  value: DraftActivity[];
  onChange: (next: DraftActivity[]) => void;
  /** Which language's title and instructions are being edited. */
  textLocale: Locale;
  onTextLocaleChange: (l: Locale) => void;
  problems: Record<string, string>;
}) {
  const { t, locale, availableLocales } = useTranslation();
  const set = (key: string, patch: Partial<DraftActivity>) => onChange(value.map((d) => (d.key === key ? { ...d, ...patch } : d)));
  const move = (i: number, by: -1 | 1) => {
    const next = [...value];
    const [row] = next.splice(i, 1);
    next.splice(i + by, 0, row);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      {availableLocales.length > 1 && (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink/60">{t('carePlans.editor.textIn')}</span>
          <div role="tablist" className="flex gap-1">
            {availableLocales.map((l) => (
              <button
                key={l}
                type="button"
                role="tab"
                aria-selected={textLocale === l}
                onClick={() => onTextLocaleChange(l)}
                className={cn('rounded px-2.5 py-1 text-xs font-medium', textLocale === l ? 'bg-brand-light text-brand-dark' : 'text-ink/60 hover:bg-paper')}
              >
                {t(`carePlans.editor.language.${l}`)}
              </button>
            ))}
          </div>
          <span className="text-xs text-ink/50">{t('carePlans.editor.textHint')}</span>
        </div>
      )}

      {value.length === 0 && <p className="rounded border border-dashed border-border px-4 py-6 text-center text-sm text-ink/50">{t('carePlans.editor.empty')}</p>}

      <ol className="space-y-3">
        {value.map((d, i) => {
          const problem = problems[d.key];
          const fallback = d.title.en || d.title.si || d.title.ta || '';
          return (
            <li key={d.key} className={cn('rounded-lg border bg-white p-3', problem ? 'border-danger/50' : 'border-border', d.isCritical && 'border-l-4 border-l-accent')}>
              <div className="flex flex-wrap items-start gap-2">
                <span className="mt-2 w-6 shrink-0 text-right text-xs tabular-nums text-ink/40">{i + 1}.</span>
                <div className="min-w-[12rem] flex-1">
                  <Input
                    aria-label={t('carePlans.editor.title')}
                    placeholder={textLocale !== 'en' && fallback ? fallback : t('carePlans.editor.titlePlaceholder')}
                    value={d.title[textLocale] ?? ''}
                    maxLength={120}
                    onChange={(e) => set(d.key, { title: { ...d.title, [textLocale]: e.target.value } })}
                  />
                </div>
                <Select aria-label={t('carePlans.editor.category')} className="w-44" value={d.category} onChange={(e) => set(d.key, { category: e.target.value as DraftActivity['category'] })}>
                  {careActivityCategoryValues.map((c) => (
                    <option key={c} value={c}>
                      {t(`carePlans.category.${c}`)}
                    </option>
                  ))}
                </Select>
                <div className="flex shrink-0 gap-1">
                  <Button type="button" size="sm" variant="ghost" aria-label={t('carePlans.editor.moveUp')} disabled={i === 0} onClick={() => move(i, -1)}>
                    <ArrowUp size={14} />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" aria-label={t('carePlans.editor.moveDown')} disabled={i === value.length - 1} onClick={() => move(i, 1)}>
                    <ArrowDown size={14} />
                  </Button>
                  <Button type="button" size="sm" variant="ghost" aria-label={t('carePlans.editor.remove')} onClick={() => onChange(value.filter((x) => x.key !== d.key))}>
                    <Trash2 size={14} className="text-danger" />
                  </Button>
                </div>
              </div>

              <div className="mt-2 grid gap-2 pl-8 sm:grid-cols-[11rem_1fr]">
                <Select aria-label={t('carePlans.editor.timing')} value={d.timing} onChange={(e) => set(d.key, { timing: e.target.value as DraftActivity['timing'], slot: e.target.value === 'SLOT' ? (d.slot ?? 'MORNING') : d.slot })}>
                  {careActivityTimingValues.map((v) => (
                    <option key={v} value={v}>
                      {t(`carePlans.timing.${v}`)}
                    </option>
                  ))}
                </Select>
                <div className="flex flex-wrap items-center gap-2">
                  {d.timing === 'SLOT' && (
                    <Select aria-label={t('carePlans.editor.slot')} className="w-56" value={d.slot ?? 'MORNING'} onChange={(e) => set(d.key, { slot: e.target.value as DraftActivity['slot'] })}>
                      {careSlotValues.map((s) => (
                        <option key={s} value={s}>
                          {t(`carePlans.slot.${s}`)}
                        </option>
                      ))}
                    </Select>
                  )}
                  {d.timing === 'AT_TIMES' && (
                    <Input
                      aria-label={t('carePlans.editor.times')}
                      className="w-56"
                      placeholder="08:00, 14:00, 20:00"
                      value={d.timesText}
                      onChange={(e) => set(d.key, { timesText: e.target.value })}
                    />
                  )}
                  <label className="flex items-center gap-1.5 text-sm text-ink">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border text-accent focus:ring-accent"
                      checked={d.isCritical}
                      onChange={(e) => set(d.key, { isCritical: e.target.checked })}
                    />
                    {t('carePlans.editor.critical')}
                  </label>
                </div>
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-1 pl-8" role="group" aria-label={t('carePlans.editor.days')}>
                <button
                  type="button"
                  aria-pressed={!d.daysOfWeek}
                  onClick={() => set(d.key, { daysOfWeek: null })}
                  className={cn('rounded-full border px-2.5 py-0.5 text-xs', !d.daysOfWeek ? 'border-brand bg-brand-light text-brand-dark' : 'border-border text-ink/60')}
                >
                  {t('carePlans.editor.everyShift')}
                </button>
                {ALL_WEEKDAYS.map((wd) => {
                  const on = Boolean(d.daysOfWeek?.includes(wd));
                  return (
                    <button
                      key={wd}
                      type="button"
                      aria-pressed={on}
                      onClick={() => {
                        const current = d.daysOfWeek ?? [];
                        const next = (on ? current.filter((x) => x !== wd) : [...current, wd]).sort() as IsoWeekday[];
                        set(d.key, { daysOfWeek: next.length === 0 || next.length === 7 ? null : next });
                      }}
                      className={cn('rounded-full border px-2.5 py-0.5 text-xs', on ? 'border-brand bg-brand-light text-brand-dark' : 'border-border text-ink/60')}
                    >
                      {fmtWeekday(wd, locale)}
                    </button>
                  );
                })}
              </div>

              <div className="mt-2 pl-8">
                <Textarea
                  aria-label={t('carePlans.editor.instructions')}
                  rows={2}
                  maxLength={1000}
                  placeholder={t('carePlans.editor.instructionsPlaceholder')}
                  value={d.instructions[textLocale] ?? ''}
                  onChange={(e) => set(d.key, { instructions: { ...d.instructions, [textLocale]: e.target.value } })}
                />
              </div>
              {problem && (
                <p role="alert" className="mt-1 pl-8 text-xs text-danger">
                  {t(`carePlans.problem.${problem}`)}
                </p>
              )}
            </li>
          );
        })}
      </ol>

      <Button type="button" variant="secondary" size="sm" onClick={() => onChange([...value, blankDraft()])}>
        <Plus size={14} aria-hidden />
        {t('carePlans.editor.add')}
      </Button>
    </div>
  );
}

/** One line saying when an activity is due: "08:00, 20:00 · Mon Wed Fri". */
export function whenText(a: CareActivityFields, t: (k: string, v?: Record<string, string | number>) => string, locale: Locale) {
  const when = a.timing === 'AT_TIMES' ? a.times.join(', ') : a.timing === 'SLOT' && a.slot ? t(`carePlans.slot.${a.slot}`) : t('carePlans.timing.ANY');
  const days = a.daysOfWeek ? a.daysOfWeek.map((d) => fmtWeekday(d, locale)).join(' ') : t('carePlans.editor.everyShift');
  return `${when} · ${days}`;
}
