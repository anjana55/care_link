'use client';

import { useViewDocument } from '@/lib/hooks/use-caregivers';
import { Button } from '@/components/ui/button';
import { useTranslation } from '@/lib/i18n/provider';

export function DocumentViewButton({ caregiverId, documentId }: { caregiverId: string; documentId: string }) {
  const { t } = useTranslation();
  const viewDoc = useViewDocument(caregiverId);

  return (
    <Button
      type="button"
      variant="ghost"
      size="sm"
      className="text-xs text-brand hover:underline"
      disabled={viewDoc.isPending}
      onClick={() => viewDoc.mutate(documentId)}
    >
      {t('caregivers.edit.view')}
    </Button>
  );
}
