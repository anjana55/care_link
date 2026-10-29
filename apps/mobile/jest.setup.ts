// The library's own in-memory mock: same API as the device storage.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock'),
);

// Without this, SafeAreaProvider waits for the device to report insets - which
// never happens in Jest - and renders nothing.
jest.mock('react-native-safe-area-context', () => require('react-native-safe-area-context/jest/mock').default);
