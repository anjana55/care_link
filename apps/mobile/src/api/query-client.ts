import { QueryClient } from '@tanstack/react-query';

/** The app's React Query client. A factory, so tests can use one without cache-expiry timers. */
export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // Phones lose signal; one retry, then show what failed.
        retry: 1,
      },
    },
  });
}
