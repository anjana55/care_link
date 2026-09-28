'use client';

import { useState } from 'react';
import type { ExtractedRequirements, SearchRequest } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useMetaSkills, useMetaLocations } from '@/lib/hooks/use-public-search';
import { mockExtractRequirements } from '@/lib/ai/mock-extract';
import { LoadingState } from '@/components/common/states';

interface AiSearchPanelProps {
  onSubmit: (request: SearchRequest) => void;
}

export function AiSearchPanel({ onSubmit }: AiSearchPanelProps) {
  const { t } = useTranslation();
  const { data: skills = [] } = useMetaSkills();
  const { data: locations = [] } = useMetaLocations();
  const [query, setQuery] = useState('');
  const [extracting, setExtracting] = useState(false);
  const [extracted, setExtracted] = useState<ExtractedRequirements | null>(null);

  function handleExtract(e: React.FormEvent) {
    e.preventDefault();
    if (!query.trim()) return;
    setExtracting(true);
    // Simulated latency so this reads the same as a real model call would -
    // the extraction itself is the local mock (see lib/ai/mock-extract.ts).
    setTimeout(() => {
      setExtracted(mockExtractRequirements(query, skills, locations));
      setExtracting(false);
    }, 400);
  }

  function updateSummaryLine(group: keyof ExtractedRequirements['summary'], index: number, value: string) {
    // NOTE: editing/removing a summary line only changes what's displayed,
    // not the underlying structured `requirements` object - true two-way
    // binding between free-text summary lines and structured fields needs
    // the real extraction pipeline's schema, not the mock's. Good enough to
    // demonstrate the intended UX; revisit once server-side extraction
    // lands.
    if (!extracted) return;
    const next = { ...extracted, summary: { ...extracted.summary } };
    next.summary[group] = [...next.summary[group]];
    next.summary[group][index] = value;
    setExtracted(next);
  }

  function removeSummaryLine(group: keyof ExtractedRequirements['summary'], index: number) {
    if (!extracted) return;
    const next = { ...extracted, summary: { ...extracted.summary } };
    next.summary[group] = next.summary[group].filter((_, i) => i !== index);
    setExtracted(next);
  }

  const groups: { key: keyof ExtractedRequirements['summary']; label: string }[] = [
    { key: 'patient', label: t('aiSearch.extractedPatient') },
    { key: 'location', label: t('aiSearch.extractedLocation') },
    { key: 'care', label: t('aiSearch.extractedCare') },
    { key: 'preferences', label: t('aiSearch.extractedPreferences') },
  ];

  return (
    <div className="space-y-6">
      <form onSubmit={handleExtract} className="space-y-3">
        <label htmlFor="ai-query" className="block text-sm font-semibold text-ink/80">
          {t('aiSearch.label')}
        </label>
        <textarea
          id="ai-query"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={t('aiSearch.placeholder')}
          rows={4}
          className="w-full rounded-lg border border-border bg-white px-4 py-3 text-sm focus:border-brand focus:outline-none"
        />
        <p className="text-xs italic text-ink/50">{t('aiSearch.example')}</p>
        <button
          type="submit"
          disabled={!query.trim() || extracting}
          className="rounded-DEFAULT bg-brand px-6 py-2.5 text-sm font-semibold text-white hover:bg-brand-dark disabled:opacity-50"
        >
          {t('aiSearch.submit')}
        </button>
      </form>

      {extracting && <LoadingState label={t('loading.extracting')} />}

      {extracted && !extracting && (
        <div className="rounded-lg border border-brand-light bg-brand-light/40 p-5">
          <h3 className="text-sm font-semibold text-ink">{t('aiSearch.extractedTitle')}</h3>
          <p className="mt-1 text-xs text-ink/60">{t('aiSearch.editHint')}</p>

          <div className="mt-4 grid gap-4 sm:grid-cols-2">
            {groups.map((group) => (
              <div key={group.key}>
                <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink/50">{group.label}</p>
                {extracted.summary[group.key].length === 0 ? (
                  <p className="text-sm text-ink/40">—</p>
                ) : (
                  <ul className="space-y-1.5">
                    {extracted.summary[group.key].map((line, i) => (
                      <li key={i} className="flex items-center gap-2">
                        <input
                          value={line}
                          onChange={(e) => updateSummaryLine(group.key, i, e.target.value)}
                          className="flex-1 rounded-DEFAULT border border-border bg-white px-2 py-1 text-sm"
                        />
                        <button
                          type="button"
                          onClick={() => removeSummaryLine(group.key, i)}
                          aria-label={`Remove ${line}`}
                          className="text-ink/40 hover:text-danger"
                        >
                          ×
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>

          <button
            type="button"
            onClick={() => onSubmit(extracted.requirements)}
            className="mt-5 rounded-DEFAULT bg-accent px-6 py-2.5 text-sm font-semibold text-white hover:opacity-90"
          >
            {t('aiSearch.searchWithThis')}
          </button>
        </div>
      )}
    </div>
  );
}
