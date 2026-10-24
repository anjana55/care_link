'use client';

import { BellRing } from 'lucide-react';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { useUpdateCaregiver } from '@/lib/hooks/use-caregivers';
import { Card, CardContent } from '@/components/ui/card';

/**
 * "Auto notify incoming requests". On: the caregiver is told straight away
 * when a client asks for them. Off (the default): staff decide when, with
 * "Notify caregiver" on the request.
 */
export function AutoNotifyToggle({ caregiverId, enabled, canEdit }: { caregiverId: string; enabled: boolean; canEdit: boolean }) {
  const { t } = useTranslation();
  const update = useUpdateCaregiver(caregiverId);
  const error = update.error ? (update.error instanceof ApiError ? update.error.message : t('common.actionFailed')) : null;

  return (
    <Card>
      <CardContent className="flex items-start gap-3">
        <BellRing className="mt-0.5 h-5 w-5 shrink-0 text-brand" aria-hidden />
        <div className="flex-1">
          <label className="flex items-center justify-between gap-4">
            <span className="text-sm font-semibold text-ink">{t('caregivers.autoNotify.label')}</span>
            <input
              type="checkbox"
              role="switch"
              aria-checked={enabled}
              checked={enabled}
              disabled={!canEdit || update.isPending}
              onChange={(e) => update.mutate({ autoNotifyRequests: e.target.checked })}
              className="h-5 w-5 rounded border-border text-brand focus:ring-brand"
            />
          </label>
          <p className="mt-1 text-xs text-ink/60">{enabled ? t('caregivers.autoNotify.on') : t('caregivers.autoNotify.off')}</p>
          {error && (
            <p role="alert" className="mt-1 text-xs text-danger">
              {error}
            </p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
