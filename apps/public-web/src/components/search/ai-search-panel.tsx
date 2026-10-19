'use client';

import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import type { ExtractedRequirements, SearchRequest } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { publicSearchApi } from '@/lib/api/public-search';
import { ApiError } from '@/lib/api/client';
import { LoadingState } from '@/components/common/states';
import { Label, Textarea } from '@/components/ui/input';
import { NormalSearchForm } from '@/components/search/normal-search-form';

interface AiSearchPanelProps {
  /** `query` is what the visitor typed - it re-ranks the results and pre-fills sign-up's care description. */
  onSubmit: (request: SearchRequest, query: string) => void;
  /** A remembered AI search, so coming back to /find shows what was searched. */
  initialQuery?: string;
  initialRequest?: SearchRequest;
}

/**
 * AI Search: the visitor describes the care they need in their own words;
 * the API's model turns that into the same structured requirements Normal
 * Search uses, and the visitor checks and corrects them in that same form
 * before anything is searched. Nothing the model read is applied unseen.
 */
export function AiSearchPanel({ onSubmit, initialQuery, initialRequest }: AiSearchPanelProps) {
  const { t, locale } = useTranslation();
  const [query, setQuery] = useState(initialQuery ?? '');
  const [extracted, setExtracted] = useState<ExtractedRequirements | null>(
    initialRequest ? { requirements: initialRequest, summary: { patient: [], location: [], care: [], preferences: [] } } : null,
  );
  // The query the shown requirements were read from - edits to the box after
  // that must not silently change what the results are re-ranked by.
  const [understoodQuery, setUnderstoodQuery] = useState(initialQuery ?? '');
  const [formKey, setFormKey] = useState(0);

  const extract = useMutation({
    mutationFn: (text: string) => publicSearchApi.aiExtract(text, locale),
    onSuccess: (result, text) => {
      setExtracted(result);
      setUnderstoodQuery(text);
      setFormKey((k) => k + 1);
    },
  });

  function handleExtract(e: React.FormEvent) {
    e.preventDefault();
    const text = query.trim();
    if (text.length < 10) return;
    extract.mutate(text);
  }

  const groups: { key: keyof ExtractedRequirements['summary']; label: string }[] = [
    { key: 'patient', label: t('aiSearch.extractedPatient') },
    { key: 'location', label: t('aiSearch.extractedLocation') },
    { key: 'care', label: t('aiSearch.extractedCare') },
    { key: 'preferences', label: t('aiSearch.extractedPreferences') },
  ];
  const hasSummary = extracted && groups.some((g) => extracted.summary[g.key].length > 0);
  const unavailable = extract.error instanceof ApiError && extract.error.status === 503;

  return (
    <div className="space-y-6">
      <form onSubmit={handleExtract} className="space-y-3">
        <Label htmlFor="ai-query">{t('aiSearch.label')}</Label>
        <Textarea
          id="ai-query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('aiSearch.placeholder')}
          rows={4}
          maxLength={1000}
        />
        <p className="text-xs italic text-ink/50">{t('aiSearch.example')}</p>
        <button
          type="submit"
          disabled={query.trim().length < 10 || extract.isPending}
          className="rounded-DEFAULT bg-brand px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {t('aiSearch.submit')}
        </button>
      </form>

      {extract.isPending && <LoadingState label={t('loading.extracting')} />}

      {extract.isError && (
        <p role="alert" className="rounded-DEFAULT border border-danger/30 bg-danger/5 p-3 text-sm text-danger">
          {unavailable ? t('aiSearch.unavailable') : t('aiSearch.failed')}
        </p>
      )}

      {extracted && !extract.isPending && (
        <div className="rounded-lg border border-brand-light bg-brand-light/40 p-5">
          <h3 className="text-sm font-semibold text-ink">{t('aiSearch.extractedTitle')}</h3>
          <p className="mt-1 text-xs text-ink/60">{t('aiSearch.editHint')}</p>

          {hasSummary && (
            <div className="mt-4 grid gap-4 sm:grid-cols-2">
              {groups.map((group) =>
                extracted.summary[group.key].length === 0 ? null : (
                  <div key={group.key}>
                    <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink/50">{group.label}</p>
                    <ul className="flex flex-wrap gap-1.5">
                      {extracted.summary[group.key].map((line, i) => (
                        <li key={i} className="rounded-full border border-brand/30 bg-white px-3 py-1 text-sm text-ink/80">
                          {line}
                        </li>
                      ))}
                    </ul>
                  </div>
                ),
              )}
            </div>
          )}

          <div className="mt-5 rounded-DEFAULT bg-white p-4 sm:p-5">
            <NormalSearchForm
              key={formKey}
              initialValues={{ ...extracted.requirements, page: 1, pageSize: 20 }}
              submitLabel={t('aiSearch.searchWithThis')}
              onSubmit={(request) => onSubmit(request, understoodQuery || query.trim())}
            />
          </div>
        </div>
      )}
    </div>
  );
}
