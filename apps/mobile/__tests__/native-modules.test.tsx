import { act, renderHook } from '@testing-library/react-native';
import { useDeviceLocation } from '../src/search/location';
import { AppProviders, serveApi } from '../test-utils/app';

// A development build made before expo-location was added: the native module isn't there...
jest.mock('../src/native', () => ({ hasNativeModule: () => false }));
// ...and loading the package would fail, as it does on such a phone.
const mockLoads = { count: 0 };
jest.mock('expo-location', () => {
  mockLoads.count += 1;
  throw new Error("Cannot find native module 'ExpoLocation'");
});

describe('a build without a native module', () => {
  it('says the phone can’t share its location, without loading the module at all', async () => {
    serveApi({});
    const { result } = await renderHook(() => useDeviceLocation('en'), { wrapper: AppProviders });
    let found: unknown = 'not called';
    await act(async () => void (found = await result.current.locate()));
    expect(found).toBeNull();
    expect(result.current.error).toBe('unsupported');
    // On a phone, even a caught load shows a red error in development builds.
    expect(mockLoads.count).toBe(0);
  });
});
