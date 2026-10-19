import type { PublicSearchResponse } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';
import { useCaregiverRelations, useIsClient } from '@/lib/hooks/use-client-care';
import { useAuth } from '@/lib/api/auth-context';
import { ResultCard } from './result-card';

interface ResultsListProps {
  response: PublicSearchResponse;
  onPageChange: (page: number) => void;
}

export function ResultsList({ response, onPageChange }: ResultsListProps) {
  const { t } = useTranslation();
  // One call for the whole page of results, and only for a signed-in client:
  // whether each caregiver is saved or already has an open request.
  const isClient = Boolean(useIsClient());
  const { user, loading } = useAuth();
  const signedOut = !loading && !user;
  const relations = useCaregiverRelations(isClient ? response.items.map((i) => i.publicId) : []);

  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-lg font-semibold text-ink">{t('results.title')}</h2>
        <p className="text-sm text-ink/50">{response.total}</p>
      </div>
      {'aiRanked' in response && response.aiRanked === true && (
        <p className="-mt-2 mb-4 text-xs text-ink/60">{t('results.aiRankedNote')}</p>
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        {response.items.map((item) => (
          <ResultCard
            key={item.publicId}
            caregiver={item}
            relation={isClient ? (relations.byId.get(item.publicId) ?? { caregiverPublicId: item.publicId, saved: false, openRequest: null }) : undefined}
            deviceSave={signedOut}
          />
        ))}
      </div>

      {response.totalPages > 1 && (
        <div className="mt-6 flex items-center justify-center gap-3">
          <button
            type="button"
            disabled={response.page <= 1}
            onClick={() => onPageChange(response.page - 1)}
            className="rounded-DEFAULT border border-border px-4 py-2 text-sm disabled:opacity-40"
          >
            {t('results.previous')}
          </button>
          <span className="text-sm text-ink/60">{t('results.page', { page: response.page, totalPages: response.totalPages })}</span>
          <button
            type="button"
            disabled={response.page >= response.totalPages}
            onClick={() => onPageChange(response.page + 1)}
            className="rounded-DEFAULT border border-border px-4 py-2 text-sm disabled:opacity-40"
          >
            {t('results.next')}
          </button>
        </div>
      )}
    </div>
  );
}
