import { act, renderHook } from '@testing-library/react-native';
import { useDeviceLocation } from '../src/search/location';
import { chooseFile, choosePhoto, clearViewedDocuments, openDocument, takePhoto } from '../src/caregiver/document-files';
import { AppProviders, serveApi } from '../test-utils/app';

// A development build made before expo-location, expo-image-picker (and so on) were added: the native modules aren't there...
jest.mock('../src/native', () => ({ hasNativeModule: () => false }));
// ...and loading the package would fail, as it does on such a phone.
const mockLoads = { count: 0 };
jest.mock('expo-location', () => {
  mockLoads.count += 1;
  throw new Error("Cannot find native module 'ExpoLocation'");
});
jest.mock('expo-image-picker', () => {
  mockLoads.count += 1;
  throw new Error("Cannot find native module 'ExponentImagePicker'");
});
jest.mock('expo-file-system', () => {
  mockLoads.count += 1;
  throw new Error("Cannot find native module 'FileSystem'");
});

beforeEach(() => void (mockLoads.count = 0));

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

  it("says the camera, photos and files aren't on this version, without loading them", async () => {
    expect(await takePhoto()).toEqual({ error: 'unsupported' });
    expect(await choosePhoto()).toEqual({ error: 'unsupported' });
    expect(await chooseFile()).toEqual({ error: 'unsupported' });
    await expect(openDocument('https://x/file', {}, { id: 'd-1', mimeType: 'application/pdf', title: 'NIC' })).rejects.toThrow('unsupported');
    expect(() => clearViewedDocuments()).not.toThrow();
    expect(mockLoads.count).toBe(0);
  });
});
