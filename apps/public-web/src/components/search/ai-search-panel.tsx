'use client';

import { useMemo, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Loader2, SendHorizontal, Sparkles } from 'lucide-react';
import {
  AI_FIRST_MAX,
  AI_REPLY_MAX,
  EMPTY_AI_SUMMARY,
  careTypeValues,
  combineTurns,
  lacksCareDetail,
  missingOf,
  understoodNothingIn,
  type CareType,
  type ExtractedRequirements,
  type SearchRequest,
} from '@care-platform/shared';
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
  | { role: 'assistant'; kind: 'ask-care-type'; summary?: ExtractedRequirements['summary'] }
  | { role: 'assistant'; kind: 'ask-location'; retry: boolean; understoodNothing: boolean; summary?: ExtractedRequirements['summary'] }
  | { role: 'assistant'; kind: 'results'; summary?: ExtractedRequirements['summary']; suggestMore: boolean };

// The conversation's rules are shared with the mobile app (@care-platform/shared, ai-search.ts).
const FIRST_MAX = AI_FIRST_MAX;
const REPLY_MAX = AI_REPLY_MAX;
const EMPTY_SUMMARY = EMPTY_AI_SUMMARY;
export { combineTurns };

/**
 * AI Search as a short conversation whose only goal is to get caregivers on
 * screen with as few steps as possible:
 *
 *  1. The visitor describes the care they need, in their own words.
 *  2. If that is enough to search (it only needs an area), the results show
 *     straight away, with what was understood as chips and the full filter
 *     form below the results for anyone who wants to adjust.
 *  3. If not, the assistant asks for just the missing pieces - first the type
 *     of care (five one-tap choices; it is never guessed), then the area (in
 *     words, or a district list as a one-tap alternative) - and searches as
 *     soon as it has both.
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

  // A care type the visitor picked with a button. Their words may never name
  // it, so it is laid over every later extraction that did not find one.
  const [pickedCareType, setPickedCareType] = useState<CareType | null>(initialRequest?.careType ?? null);

  function withPickedCareType(result: ExtractedRequirements, picked: CareType | null): ExtractedRequirements {
    if (!picked || result.requirements.careType) return result;
    return {
      ...result,
      requirements: { ...result.requirements, careType: picked },
      summary: { ...result.summary, care: [t(`careTypes.${picked}`), ...result.summary.care] },
      missing: result.missing?.filter((m) => m !== 'careType'),
    };
  }

  // The latest conversation, for callbacks that run after a render (a mutation
  // settling) - updater functions must stay free of side effects like a search.
  const entriesRef = useRef(entries);
  entriesRef.current = entries;

  /** Asks for the next missing piece, or searches when nothing is missing. */
  function proceed(result: ExtractedRequirements, query: string, prev: Entry[]) {
    const next = nextEntries(result, query, prev);
    entriesRef.current = next;
    setEntries(next);
  }

  function nextEntries(result: ExtractedRequirements, query: string, prev: Entry[]): Entry[] {
    const missing = missingOf(result);
    if (missing.includes('careType')) {
      return [...prev, { role: 'assistant', kind: 'ask-care-type', summary: result.summary }];
    }
    if (missing.includes('location')) {
      // Put the cursor where the answer goes - one less tap on a phone.
      setTimeout(() => replyRef.current?.focus(), 0);
      return [
        ...prev,
        {
          role: 'assistant',
          kind: 'ask-location',
          retry: prev.some((e) => e.role === 'assistant' && e.kind === 'ask-location'),
          understoodNothing: understoodNothingIn(result),
          summary: result.summary,
        },
      ];
    }
    onSearch({ ...result.requirements, page: 1, pageSize: 20 }, query);
    return [...prev, { role: 'assistant', kind: 'results', summary: result.summary, suggestMore: lacksCareDetail(result.requirements) }];
  }

  const extract = useMutation({
    mutationFn: (text: string) => publicSearchApi.aiExtract(text, locale),
    onSuccess: (raw, text) => {
      const result = withPickedCareType(raw, pickedCareType);
      setCurrent(result);
      proceed(result, text, entriesRef.current);
    },
  });

  const lastAssistant = [...entries].reverse().find((e) => e.role === 'assistant');
  const askingLocation = lastAssistant?.kind === 'ask-location';
  const askingCareType = lastAssistant?.kind === 'ask-care-type';
  const started = entries.length > 0;

  function say(raw: string) {
    const text = raw.trim();
    if (text.length < 2 || extract.isPending) return;
    const nextTurns = [...turns, text];
    setTurns(nextTurns);
    const withUser: Entry[] = [...entriesRef.current, { role: 'user', text }];
    entriesRef.current = withUser;
    setEntries(withUser);
    setDraft('');
    extract.mutate(combineTurns(nextTurns));
  }

  /** The one-tap answer to "where?": no model call needed. */
  function pickDistrict(value: string) {
    const district = districts.find((d) => String(d.id) === value);
    if (!district || !current) return;
    const nextTurns = [...turns, district.name];
    const summary = { ...current.summary, location: [district.name] };
    const requirements: SearchRequest = { ...current.requirements, location: { districtId: district.id }, page: 1, pageSize: 20 };
    const next: ExtractedRequirements = { ...current, requirements, summary, missing: (current.missing ?? []).filter((m) => m !== 'location') };
    setTurns(nextTurns);
    setCurrent(next);
    proceed(next, combineTurns(nextTurns), [...entriesRef.current, { role: 'user', text: district.name }]);
  }

  /** The one-tap answer to "what kind of care?": no model call needed. */
  function pickCareType(type: CareType) {
    if (!current) return;
    const label = t(`careTypes.${type}`);
    const nextTurns = [...turns, label];
    const next = withPickedCareType({ ...current, requirements: { ...current.requirements, careType: undefined } }, type);
    setPickedCareType(type);
    setTurns(nextTurns);
    setCurrent(next);
    proceed(next, combineTurns(nextTurns), [...entriesRef.current, { role: 'user', text: label }]);
  }

  function startOver() {
    setPickedCareType(null);
    setTurns([]);
    entriesRef.current = [];
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
                {entry.kind === 'ask-care-type' ? (
                  <div className="space-y-2">
                    <p>{t('aiSearch.askCareType')}</p>
                    {isLast && (
                      <div role="group" aria-label={t('normalSearch.careType')} className="flex flex-wrap gap-2">
                        {careTypeValues.map((type) => (
                          <button
                            key={type}
                            type="button"
                            onClick={() => pickCareType(type)}
                            disabled={extract.isPending}
                            className="rounded-full border border-brand/40 bg-white px-3 py-1.5 text-sm text-ink hover:border-brand hover:bg-brand hover:text-white disabled:opacity-50"
                          >
                            {t(`careTypes.${type}`)}
                          </button>
                        ))}
                      </div>
                    )}
                  </div>
                ) : entry.kind === 'ask-location' ? (
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
          {askingLocation || askingCareType ? t('aiSearch.replyLabel') : t('aiSearch.moreDetailsLabel')}
        </label>
        <Input
          id="ai-reply"
          ref={replyRef}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder={askingCareType ? t('aiSearch.careTypeReplyPlaceholder') : askingLocation ? t('aiSearch.replyPlaceholder') : t('aiSearch.moreDetailsPlaceholder')}
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
