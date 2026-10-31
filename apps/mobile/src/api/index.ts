import { config } from '@/config';
import { currentLanguage } from '@/i18n';
import { createApiClient } from './client';
import { createSecureTokenStore } from './token-store';

export { ApiError, NetworkError, SessionCheckFailedError, SessionExpiredError } from './errors';

/** Called when the API refuses the session (refresh rejected). AuthProvider subscribes. */
const sessionExpiredListeners = new Set<() => void>();
export function onSessionExpired(listener: () => void): () => void {
  sessionExpiredListeners.add(listener);
  return () => sessionExpiredListeners.delete(listener);
}

export const tokenStore = createSecureTokenStore();

export const api = createApiClient({
  baseUrl: config.apiUrl,
  tokens: tokenStore,
  language: currentLanguage,
  onSessionExpired: () => sessionExpiredListeners.forEach((listener) => listener()),
});
