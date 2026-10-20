'use client';

import { useEffect } from 'react';

/**
 * Applies `?<name>=<value>` from the URL once, on mount, when it is one of
 * `allowed` - so the dashboard can link straight to a filtered list
 * ("/invoices?tab=overdue"). Read from window.location rather than
 * useSearchParams, which would need a Suspense boundary on every list page.
 */
export function useInitialParam<T extends string>(name: string, allowed: readonly T[], apply: (value: T) => void) {
  useEffect(() => {
    const value = new URLSearchParams(window.location.search).get(name);
    if (value && (allowed as readonly string[]).includes(value)) apply(value as T);
    // Mount only: later navigation within the page is the page's own state.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
}
