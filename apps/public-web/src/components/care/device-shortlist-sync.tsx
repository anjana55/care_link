'use client';

import { useEffect, useRef } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { api } from '@/lib/api/client';
import { useIsClient } from '@/lib/hooks/use-client-care';
import { readDeviceShortlist, removeFromDeviceShortlist } from '@/lib/care-intent';

/**
 * Copies caregivers saved on this device before signing in (DeviceSaveButton)
 * into the client's account the first time a client session is seen, then
 * forgets the ones that made it. Any that fail - a caregiver since removed,
 * a dropped connection - stay on the device and are tried again next time.
 * Renders nothing; mounted once in the root layout.
 */
export function DeviceShortlistSync() {
  const client = useIsClient();
  const queryClient = useQueryClient();
  const syncedFor = useRef<string | null>(null);

  useEffect(() => {
    const patientId = client?.patientId ?? client?.userId;
    if (!patientId || syncedFor.current === patientId) return;
    syncedFor.current = patientId;
    const ids = readDeviceShortlist();
    if (ids.length === 0) return;

    // Not cancelled on unmount: the saves are idempotent PUTs, and forgetting
    // the ones that landed is right whenever they land.
    void (async () => {
      const results = await Promise.allSettled(ids.map((id) => api.put(`/me/saved-caregivers/${id}`, {})));
      const copied = ids.filter((_, i) => results[i].status === 'fulfilled');
      removeFromDeviceShortlist(copied);
      if (copied.length > 0) await queryClient.invalidateQueries({ queryKey: ['client'] });
    })();
  }, [client, queryClient]);

  return null;
}
