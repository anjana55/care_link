'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth, postLoginPath } from '@/lib/api/auth-context';

export default function RootPage() {
  const router = useRouter();
  const { user, loading } = useAuth();

  useEffect(() => {
    if (loading) return;
    router.replace(user ? postLoginPath(user) : '/login');
  }, [loading, user, router]);

  return null;
}
