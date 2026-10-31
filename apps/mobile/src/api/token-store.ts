import * as SecureStore from 'expo-secure-store';
import type { Tokens } from '@care-platform/shared';

/**
 * Where the session lives: the phone's encrypted storage (iOS Keychain,
 * Android Keystore), never AsyncStorage. Secure storage is asynchronous, so the
 * tokens are read once at launch (`load`) and kept in memory; every change is
 * written through.
 */
export interface TokenStore {
  load(): Promise<Tokens | null>;
  get(): Tokens | null;
  set(tokens: Tokens): Promise<void>;
  clear(): Promise<void>;
}

const KEY = 'carelink.session';

export function createSecureTokenStore(): TokenStore {
  let current: Tokens | null = null;
  return {
    async load() {
      try {
        const raw = await SecureStore.getItemAsync(KEY);
        current = raw ? (JSON.parse(raw) as Tokens) : null;
      } catch {
        current = null; // unreadable (e.g. restored onto a new phone): start signed out
      }
      return current;
    },
    get: () => current,
    async set(tokens) {
      current = tokens;
      // Not readable while the phone is locked, and never copied into backups or onto another phone.
      await SecureStore.setItemAsync(KEY, JSON.stringify(tokens), {
        keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
      });
    },
    async clear() {
      current = null;
      await SecureStore.deleteItemAsync(KEY).catch(() => undefined);
    },
  };
}
