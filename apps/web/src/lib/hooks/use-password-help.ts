'use client';

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';

export type PasswordHelpRequest = { mode: 'SEND_LINK' } | { mode: 'SET_PASSWORD'; newPassword: string };
export interface PasswordHelpResult {
  mode: 'SEND_LINK' | 'SET_PASSWORD';
  email: string;
  expiresAt?: string;
}

/**
 * An admin helping a caregiver or client with their password: email them a
 * reset link, or set one to hand over. `path` is the person's endpoint
 * (/caregivers/:id/sign-in/password or /patients/:id/password); `refresh` the
 * query to reload afterwards, so "Password: set" updates.
 */
export function usePasswordHelp(path: string, refresh: unknown[]) {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (body: PasswordHelpRequest): Promise<PasswordHelpResult> => {
      const res = await api.post<PasswordHelpResult | { passwordResult: PasswordHelpResult }>(path, body);
      return 'passwordResult' in res ? res.passwordResult : res;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: refresh }),
  });
}
