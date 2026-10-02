'use client';

import { useQuery } from '@tanstack/react-query';
import type { WhatsappPublicConfig } from '@care-platform/shared';
import { api } from '../api/client';

/** What the sign-in screens may offer. Anonymous; carries no secrets. */
export function useWhatsappConfig() {
  return useQuery({
    queryKey: ['whatsapp-config'],
    queryFn: () => api.get<WhatsappPublicConfig>('/auth/whatsapp/config'),
    // A failed lookup just means "don't show the WhatsApp option" - never block the email form on it.
    retry: false,
    staleTime: 60_000,
  });
}
