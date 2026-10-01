'use client';

import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import type { StaffUser } from '../api/types';

export function useStaffUsers() {
  return useQuery({
    queryKey: ['users'],
    queryFn: () => api.get<StaffUser[]>('/users'),
  });
}
