'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { EmailSettings } from '../api/types';

/** Admin-only: the outgoing mail server settings. */
export function useEmailSettings() {
  return useQuery({
    queryKey: ['email-settings'],
    queryFn: () => api.get<EmailSettings>('/settings/email'),
  });
}
