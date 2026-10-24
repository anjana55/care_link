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
 *
 * Not available while the caregiver prefers phone calls: staff ring them
 * instead, so the switch is shown off and locked with the reason underneath.
 * The API enforces the same rule.
 */
export function AutoNotifyToggle({
  caregiverId,
  enabled,
  canEdit,
  preferredContactMethod,
}: {
  caregiverId: string;
  enabled: boolean;
  canEdit: boolean;
  preferredContactMethod?: string | null;
}) {
  const { t } = useTranslation();
  const update = useUpdateCaregiver(caregiverId);
  const phoneOnly = preferredContactMethod === 'PHONE_CALL';
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
              aria-checked={enabled && !phoneOnly}
              checked={enabled && !phoneOnly}
              disabled={!canEdit || update.isPending || phoneOnly}
              onChange={(e) => update.mutate({ autoNotifyRequests: e.target.checked })}
              className="h-5 w-5 rounded border-border text-brand focus:ring-brand"
            />
          </label>
          <p className="mt-1 text-xs text-ink/60">
            {phoneOnly ? t('caregivers.autoNotify.phoneCall') : enabled ? t('caregivers.autoNotify.on') : t('caregivers.autoNotify.off')}
          </p>
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
