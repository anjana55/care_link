// The library's own in-memory mock: same API as the device storage.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Without this, SafeAreaProvider waits for the device to report insets - which
// never happens in Jest - and renders nothing.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);

// The phone's encrypted storage, in memory.
jest.mock('expo-secure-store', () => {
  const store = new Map<string, string>();
  return {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: 'WHEN_UNLOCKED_THIS_DEVICE_ONLY',
    getItemAsync: jest.fn(async (key: string) => store.get(key) ?? null),
    setItemAsync: jest.fn(async (key: string, value: string) => void store.set(key, value)),
    deleteItemAsync: jest.fn(async (key: string) => void store.delete(key)),
    __reset: () => store.clear(),
  };
});

// Face / fingerprint unlock: a phone without it set up, unless a test says otherwise
// (mockLocalAuth in test-utils/app-lock).
jest.mock('expo-local-authentication', () => ({
  AuthenticationType: { FINGERPRINT: 1, FACIAL_RECOGNITION: 2, IRIS: 3 },
  hasHardwareAsync: jest.fn(async () => false),
  isEnrolledAsync: jest.fn(async () => false),
  supportedAuthenticationTypesAsync: jest.fn(async () => []),
  authenticateAsync: jest.fn(async () => ({ success: false, error: 'not_available' })),
}));

// Fonts load instantly; the font files themselves aren't the subject of these tests.
jest.mock('expo-font', () => ({ ...jest.requireActual('expo-font'), useFonts: () => [true, null] }));

// React Query's cache-expiry timers (5 minutes, for queries and mutations) would keep Jest running long
// after the tests finish: tests get a client that never expires its cache.
jest.mock('@/api/query-client', () => {
  const { QueryClient } = jest.requireActual('@tanstack/react-query');
  return { createQueryClient: () => new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { gcTime: Infinity } } }) };
});

// Node has a real fetch: never let a test reach the live API. Tests that need
// answers install their own fetch.
beforeEach(() => {
  globalThis.fetch = jest.fn(() => Promise.reject(new TypeError('Network request failed (no network in tests)'))) as never;
  (require('expo-secure-store') as { __reset(): void }).__reset();
});

// The phone's FormData, not Node's: on the phone a { uri, name, type } part is
// the file itself, and that is what the app's uploads send.
globalThis.FormData = require('react-native/Libraries/Network/FormData').default;

// Icons draw from a font file Jest can't load; they are decoration (labels carry the meaning).
jest.mock('@expo/vector-icons/Ionicons', () => {
  const Icon = () => null;
  return Object.assign(Icon, { glyphMap: {}, default: Object.assign(() => null, { glyphMap: {} }) });
});
