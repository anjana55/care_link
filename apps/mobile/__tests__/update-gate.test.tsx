import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Linking, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import en from '../src/i18n/en.json';
import { UpdateGate, DISMISSED_KEY } from '../src/app-config/UpdateGate';
import { AppProviders, serveApi } from '../test-utils/app';
import { tokensFor } from '../test-utils/helpers';
import { tokenStore } from '@/api';

const IOS_STORE = 'https://apps.apple.com/app/carelink/id1234567890';
const PLAY_STORE = 'https://play.google.com/store/apps/details?id=com.vivantihealth.carelink';

const config = (ios: { minimumVersion?: string; latestVersion?: string; storeUrl?: string | null }) => ({
  ios: { minimumVersion: null, latestVersion: null, storeUrl: IOS_STORE, ...ios },
  // Android's settings must not affect an iPhone (the tests run as iOS).
  android: { minimumVersion: '99.0', latestVersion: '99.0', storeUrl: PLAY_STORE },
});

async function openApp(version: string, answer: () => { status: number; body?: unknown }) {
  const calls = serveApi({ 'GET /public/app-config': answer });
  await render(
    <AppProviders>
      <UpdateGate version={version}>
        <Text>the app</Text>
      </UpdateGate>
    </AppProviders>,
  );
  return calls;
}

beforeEach(() => AsyncStorage.clear());

const brand = (s: string) => s.replace('{brand}', 'CareLink');

describe('the update check', () => {
  it('stops a build below the minimum, and sends the person to the store', async () => {
    const open = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);
    await openApp('1.0.9', () => ({ status: 200, body: config({ minimumVersion: '1.1', latestVersion: '1.2.0' }) }));

    expect(await screen.findByText(en.update.requiredTitle)).toBeTruthy();
    expect(screen.queryByText('the app')).toBeNull();
    await fireEvent.press(screen.getByRole('button', { name: en.update.update }));
    expect(open).toHaveBeenCalledWith(IOS_STORE);
  });

  it('offers a newer version once, and carries on', async () => {
    await openApp('1.1.0', () => ({ status: 200, body: config({ minimumVersion: '1.0', latestVersion: '1.2.0' }) }));
    expect(await screen.findByText(en.update.availableTitle)).toBeTruthy();
    expect(screen.getByText('the app')).toBeTruthy();
    expect(screen.getByText(brand(en.update.availableBody))).toBeTruthy();

    await fireEvent.press(screen.getByRole('button', { name: en.update.notNow }));
    expect(screen.queryByText(en.update.availableTitle)).toBeNull();
    await waitFor(async () => expect(await AsyncStorage.getItem(DISMISSED_KEY)).toBe('1.2.0'));
  });

  it('doesn’t ask again for a version already turned down', async () => {
    await AsyncStorage.setItem(DISMISSED_KEY, '1.2.0');
    await openApp('1.1.0', () => ({ status: 200, body: config({ latestVersion: '1.2.0' }) }));
    await screen.findByText('the app');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(en.update.availableTitle)).toBeNull();
  });

  it('asks again when a newer version than the one turned down comes out', async () => {
    await AsyncStorage.setItem(DISMISSED_KEY, '1.2.0');
    await openApp('1.1.0', () => ({ status: 200, body: config({ latestVersion: '1.3.0' }) }));
    expect(await screen.findByText(en.update.availableTitle)).toBeTruthy();
  });

  it('leaves an up-to-date build alone', async () => {
    await openApp('1.2.0', () => ({ status: 200, body: config({ minimumVersion: '1.0', latestVersion: '1.2' }) }));
    await screen.findByText('the app');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(en.update.availableTitle)).toBeNull();
    expect(screen.queryByText(en.update.requiredTitle)).toBeNull();
  });

  it('never blocks anyone when the check can’t be made', async () => {
    await openApp('0.0.1', () => ({ status: 503, body: { message: 'down' } }));
    await screen.findByText('the app');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(en.update.requiredTitle)).toBeNull();
  });

  it('doesn’t offer an update there is no store link for', async () => {
    await openApp('1.0.0', () => ({ status: 200, body: config({ latestVersion: '1.2.0', storeUrl: null }) }));
    await screen.findByText('the app');
    await new Promise((r) => setTimeout(r, 50));
    expect(screen.queryByText(en.update.availableTitle)).toBeNull();
  });

  it('asks without the person’s session, so an expired one can’t get in the way', async () => {
    await tokenStore.set(tokensFor('CAREGIVER'));
    const calls = await openApp('1.2.0', () => ({ status: 200, body: config({}) }));
    await waitFor(() => expect(calls.some((c) => c.route === 'GET /public/app-config')).toBe(true));
    expect(calls.find((c) => c.route === 'GET /public/app-config')!.headers.Authorization).toBeUndefined();
  });
});
