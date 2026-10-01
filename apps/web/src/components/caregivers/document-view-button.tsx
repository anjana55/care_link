'use client';

import { useEffect, useState } from 'react';
import { useViewDocument } from '@/lib/hooks/use-caregivers';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n/provider';

export function DocumentViewButton({ caregiverId, documentId }: { caregiverId: string; documentId: string }) {
  const { t } = useTranslation();
  const viewDoc = useViewDocument(caregiverId);
  const [error, setError] = useState<string | null>(null);

  // Surface failures. Without this the button was indistinguishable from a
  // no-op whenever the request failed - which is exactly what it looked like
  // while it was pointed at an unreachable port.
  useEffect(() => {
    if (viewDoc.isError) {
      setError(viewDoc.error instanceof Error ? viewDoc.error.message : 'Failed to download document');
    }
  }, [viewDoc.isError, viewDoc.error]);

  return (
    <span className="inline-flex items-center gap-2">
      <Button
        type="button"
        variant="ghost"
        size="sm"
        className="text-xs text-brand hover:underline"
        disabled={viewDoc.isPending}
        onClick={() => {
          setError(null);
          viewDoc.mutate(documentId);
        }}
      >
        {t('caregivers.edit.view')}
      </Button>
      {error && <span className="text-xs text-danger">{error}</span>}
    </span>
  );
}
