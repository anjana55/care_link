'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, SendHorizontal, Sparkles } from 'lucide-react';
import type { AiMissingField, ExtractedRequirements, SearchRequest } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { publicSearchApi } from '@/lib/api/public-search';
import { ApiError } from '@/lib/api/client';
import { useLocationTree } from '@/lib/hooks/use-public-search';
import { Input, Label, Select, Textarea } from '@/components/ui/input';

interface AiSearchPanelProps {
  /** Runs the search. `query` is everything the visitor said - it re-ranks the results and pre-fills sign-up. */
  onSearch: (request: SearchRequest, query: string) => void;
  /** Offered when AI cannot be used, so the visitor is never stuck. */
  onUseNormalSearch?: () => void;
  /** Scrolls to the advanced filters shown below the results. */
  onAdjustFilters?: () => void;
  /** Clears the conversation and the results. */
  onReset?: () => void;
  /** True once the visitor has changed the filters below by hand, so the "understood" chips may be out of date. */
  refined?: boolean;
  /** A remembered AI search, so coming back to /find shows the conversation that produced the results. */
  initialQuery?: string;
  initialRequest?: SearchRequest;
}

type Entry =
  | { role: 'user'; text: string }
  | { role: 'assistant'; kind: 'ask-location'; retry: boolean; understoodNothing: boolean; summary?: ExtractedRequirements['summary'] }
  | { role: 'assistant'; kind: 'results'; summary?: ExtractedRequirements['summary']; suggestMore: boolean };

const QUERY_MAX = 1000;
const FIRST_MAX = 800;
const REPLY_MAX = 200;

/**
 * Everything the visitor has said, one message per line, within the API's
 * 1000-character limit. The first description matters most, so when the total
 * is too long the oldest follow-ups are the ones dropped.
 */
export function combineTurns(turns: string[]): string {
  if (!turns.length) return '';
  const [first, ...rest] = turns;
  const kept = [...rest];
  let text = [first, ...kept].join('\n');
  while (text.length > QUERY_MAX && kept.length) {
    kept.shift();
    text = [first, ...kept].join('\n');
  }
  return text.slice(0, QUERY_MAX);
}

/** Required inputs still unknown. The API says so; older APIs did not, so fall back to looking. */
function missingOf(extracted: ExtractedRequirements): AiMissingField[] {
  if (extracted.missing) return extracted.missing;
  return extracted.requirements.location?.districtId ? [] : ['location'];
}

/** Nothing about the care itself - the results are by area only, and a sentence more would rank them far better. */
function lacksCareDetail(r: SearchRequest): boolean {
  return !r.mandatorySkillIds?.length && !r.optionalSkillIds?.length && !r.patient?.medicalConditions?.length && !r.shift;
}

/** The description gave nothing usable at all (a defaulted start date does not count) - ask more openly. */
function understoodNothingIn(extracted: ExtractedRequirements): boolean {
  const assumedDate = extracted.assumed?.includes('desiredStartDate') ?? false;
  return Object.entries(extracted.requirements).every(
    ([key, value]) =>
      ['page', 'pageSize', 'locale'].includes(key) ||
      (key === 'desiredStartDate' && assumedDate) ||
      value === undefined ||
      (Array.isArray(value) && value.length === 0),
  );
}

const EMPTY_SUMMARY: ExtractedRequirements['summary'] = { patient: [], location: [], care: [], preferences: [] };

/**
 * AI Search as a short conversation whose only goal is to get caregivers on
 * screen with as few steps as possible:
 *
 *  1. The visitor describes the care they need, in their own words.
 *  2. If that is enough to search (it only needs an area), the results show
 *     straight away, with what was understood as chips and the full filter
 *     form below the results for anyone who wants to adjust.
 *  3. If not, the assistant asks for just the missing piece - in words, with a
 *     district list as a one-tap alternative - and searches as soon as it has it.
 *
 * Afterwards the same box takes more details ("she speaks Tamil") and re-runs
 * the search, so improving the matches is a sentence, not a form.
 */
export function AiSearchPanel({
  onSearch,
  onUseNormalSearch,
  onAdjustFilters,
  onReset,
  refined,
  initialQuery,
  initialRequest,
}: AiSearchPanelProps) {
  const { t, locale } = useTranslation();
  const restoredTurns = initialQuery ? initialQuery.split('\n').filter(Boolean) : [];
  const [turns, setTurns] = useState<string[]>(restoredTurns);
  const [entries, setEntries] = useState<Entry[]>(() =>
    restoredTurns.length && initialRequest
      ? [...restoredTurns.map((text) => ({ role: 'user' as const, text })), { role: 'assistant', kind: 'results', suggestMore: false }]
      : [],
  );
  const [current, setCurrent] = useState<ExtractedRequirements | null>(
    initialRequest ? { requirements: initialRequest, summary: EMPTY_SUMMARY } : null,
  );
  const [draft, setDraft] = useState('');
  const replyRef = useRef<HTMLInputElement>(null);

  const { data: tree = [] } = useLocationTree(locale);
  const districts = useMemo(
    () => tree.flatMap((p) => p.districts).sort((a, b) => a.name.localeCompare(b.name, locale)),
    [tree, locale],
  );

  const extract = useMutation({
    mutationFn: (text: string) => publicSearchApi.aiExtract(text, locale),
    onSuccess: (result, text) => {
      setCurrent(result);
      if (missingOf(result).includes('location')) {
        const understoodNothing = understoodNothingIn(result);
        setEntries((prev) => [
          ...prev,
          {
            role: 'assistant',
            kind: 'ask-location',
            retry: prev.some((e) => e.role === 'assistant' && e.kind === 'ask-location'),
            understoodNothing,
            summary: result.summary,
          },
        ]);
        // Put the cursor where the answer goes - one less tap on a phone.
        setTimeout(() => replyRef.current?.focus(), 0);
        return;
      }
      setEntries((prev) => [...prev, { role: 'assistant', kind: 'results', summary: result.summary, suggestMore: lacksCareDetail(result.requirements) }]);
      onSearch({ ...result.requirements, page: 1, pageSize: 20 }, text);
    },
  });

  const lastAssistant = [...entries].reverse().find((e) => e.role === 'assistant');
  const askingLocation = lastAssistant?.kind === 'ask-location';
  const started = entries.length > 0;

  function say(raw: string) {
    const text = raw.trim();
    if (text.length < 2 || extract.isPending) return;
    const nextTurns = [...turns, text];
    setTurns(nextTurns);
    setEntries((prev) => [...prev, { role: 'user', text }]);
    setDraft('');
    extract.mutate(combineTurns(nextTurns));
  }

  /** The one-tap answer to "where?": no model call needed, search straight away. */
  function pickDistrict(value: string) {
    const district = districts.find((d) => String(d.id) === value);
    if (!district || !current) return;
    const nextTurns = [...turns, district.name];
    const summary = { ...current.summary, location: [district.name] };
    const requirements: SearchRequest = { ...current.requirements, location: { districtId: district.id }, page: 1, pageSize: 20 };
    setTurns(nextTurns);
    setCurrent({ ...current, requirements, summary, missing: [] });
    setEntries((prev) => [
      ...prev,
      { role: 'user', text: district.name },
      { role: 'assistant', kind: 'results', summary, suggestMore: lacksCareDetail(requirements) },
    ]);
    onSearch(requirements, combineTurns(nextTurns));
  }

  function startOver() {
    setTurns([]);
    setEntries([]);
    setCurrent(null);
    setDraft('');
    extract.reset();
    onReset?.();
  }

  const unavailable = extract.error instanceof ApiError && extract.error.status === 503;

  // --- first message ---------------------------------------------------------
  if (!started) {
    return (
      <form
        onSubmit={(e) => {
          e.preventDefault();
          say(draft);
        }}
        className="space-y-3"
      >
        <Label htmlFor="ai-query" className="text-sm font-semibold text-ink">
          {t('aiSearch.label')}
        </Label>
        <Textarea
          id="ai-query"
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            // Enter sends, Shift+Enter is a new line - how every chat box behaves.
            if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
              e.preventDefault();
              say(draft);
            }
          }}
          placeholder={t('aiSearch.placeholder')}
          rows={3}
          maxLength={FIRST_MAX}
          autoFocus
        />
        <p className="text-xs italic text-ink/50">{t('aiSearch.example')}</p>
        <button
          type="submit"
          disabled={draft.trim().length < 2}
          className="inline-flex items-center gap-2 rounded-DEFAULT bg-brand px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
        >
          <Sparkles className="h-4 w-4" aria-hidden />
          {t('aiSearch.findCaregivers')}
        </button>
      </form>
    );
  }

  // --- the conversation --------------------------------------------------------
  return (
    <div className="space-y-4">
      <ol className="space-y-3" aria-live="polite">
        {entries.map((entry, i) => {
          const isLast = i === entries.length - 1;
          if (entry.role === 'user') {
            return (
              <li key={i} className="flex justify-end">
                <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-sm bg-brand px-4 py-2 text-sm text-white">{entry.text}</p>
              </li>
            );
          }
          return (
            <li key={i} className="flex gap-2">
              <span className="mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-brand-light text-brand" aria-hidden>
                <Sparkles className="h-4 w-4" />
              </span>
              <div className="max-w-[85%] space-y-3 rounded-2xl rounded-tl-sm border border-border bg-brand-light/40 px-4 py-3 text-sm text-ink">
                {isLast && entry.summary && <UnderstoodChips summary={entry.summary} />}
                {entry.kind === 'ask-location' ? (
                  <p>
                    {entry.retry
                      ? t('aiSearch.askLocationRetry')
                      : entry.understoodNothing
                        ? t('aiSearch.askLocationEmpty')
                        : t('aiSearch.askLocation')}
                  </p>
                ) : (
                  <>
                    <p>
                      {t('aiSearch.showingMatches')}{' '}
                      {onAdjustFilters && (
                        <button type="button" onClick={onAdjustFilters} className="font-semibold text-brand underline-offset-2 hover:underline">
                          {t('aiSearch.adjustFilters')}
                        </button>
                      )}
                    </p>
                    {isLast && entry.suggestMore && <p className="text-ink/70">{t('aiSearch.suggestMore')}</p>}
                    {isLast && refined && <p className="text-xs text-ink/60">{t('aiSearch.filtersAdjusted')}</p>}
                  </>
                )}
              </div>
            </li>
          );
        })}
        {extract.isPending && (
          <li className="flex items-center gap-2 text-sm text-ink/60" role="status">
            <Loader2 className="h-4 w-4 animate-spin text-brand" aria-hidden />
            {t('loading.extracting')}
          </li>
        )}
      </ol>

      {extract.isError && (
        <div role="alert" className="space-y-2 rounded-DEFAULT border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          <p>{unavailable ? t('aiSearch.unavailable') : t('aiSearch.failed')}</p>
          {onUseNormalSearch && (
            <button type="button" onClick={onUseNormalSearch} className="font-semibold underline underline-offset-2">
              {t('aiSearch.useNormalSearch')}
            </button>
          )}
        </div>
      )}

      <form
        onSubmit={(e) => {
          e.preventDefault();
          say(draft);
        }}
        className="flex gap-2"
      >
        <label htmlFor="ai-reply" className="sr-only">
          {askingLocation ? t('aiSearch.replyLabel') : t('aiSearch.moreDetailsLabel')}
        </label>
        <Input
          id="ai-reply"
          ref={replyRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={askingLocation ? t('aiSearch.replyPlaceholder') : t('aiSearch.moreDetailsPlaceholder')}
          maxLength={REPLY_MAX}
          autoComplete="off"
        />
        <button
          type="submit"
          disabled={draft.trim().length < 2 || extract.isPending}
          aria-label={t('aiSearch.send')}
          className="inline-flex shrink-0 items-center gap-1.5 rounded-DEFAULT bg-brand px-4 py-2 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
        >
          <SendHorizontal className="h-4 w-4" aria-hidden />
          <span className="hidden sm:inline">{t('aiSearch.send')}</span>
        </button>
      </form>

      {askingLocation && districts.length > 0 && (
        <div className="flex flex-wrap items-center gap-2">
          <label htmlFor="ai-district" className="text-xs text-ink/60">
            {t('aiSearch.orPickDistrict')}
          </label>
          <Select id="ai-district" className="w-auto min-w-[12rem]" value="" onChange={(e) => pickDistrict(e.target.value)} disabled={extract.isPending}>
            <option value="">{t('aiSearch.pickDistrict')}</option>
            {districts.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </Select>
        </div>
      )}

      <div className="text-right">
        <button type="button" onClick={startOver} className="text-xs font-medium text-ink/60 underline-offset-2 hover:text-ink hover:underline">
          {t('aiSearch.startOver')}
        </button>
      </div>
    </div>
  );
}

function UnderstoodChips({ summary }: { summary: ExtractedRequirements['summary'] }) {
  const { t } = useTranslation();
  const lines = [...summary.patient, ...summary.location, ...summary.care, ...summary.preferences].filter(Boolean);
  if (!lines.length) return null;
  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-ink/60">{t('aiSearch.extractedTitle')}</p>
      <ul className="flex flex-wrap gap-1.5">
        {lines.map((line, i) => (
          <li key={i} className="rounded-full border border-brand/30 bg-white px-2.5 py-0.5 text-xs text-ink/80">
            {line}
          </li>
        ))}
      </ul>
    </div>
  );
}
