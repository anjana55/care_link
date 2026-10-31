import { act, fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Pressable, Text } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { PushRegistration, DEVICE_ID_KEY } from '../src/push/PushRegistration';
import { useTranslation } from '@/i18n';
import { AppProviders, serveApi } from '../test-utils/app';
import { mockRouter } from '../test-utils/router';
import { tokensFor } from '../test-utils/helpers';
import { tokenStore } from '@/api';

jest.mock('expo-router', () => require('../test-utils/router').expoRouterMock());

// The phone's notification system: a tapped notification is delivered to the listener.
const mockTapListeners: ((r: unknown) => void)[] = [];
let mockLastResponse: unknown = null;
const mockNotifications = {
  getLastNotificationResponse: () => mockLastResponse,
  clearLastNotificationResponseAsync: jest.fn(async () => undefined),
  addNotificationResponseReceivedListener: (fn: (r: unknown) => void) => {
    mockTapListeners.push(fn);
    return { remove: () => mockTapListeners.splice(mockTapListeners.indexOf(fn), 1) };
  },
};
jest.mock('../src/push/notifications', () => ({
  ...jest.requireActual('../src/push/notifications'),
  notifications: () => mockNotifications,
}));
const tap = (path: string) => ({ notification: { request: { content: { data: { path } } } } });

function SinhalaButton() {
  const { setLocale } = useTranslation();
  return (
    <Pressable onPress={() => setLocale('si')}>
      <Text>සිංහල</Text>
    </Pressable>
  );
}

const TOKEN = 'ExponentPushToken[phone-1]';

async function showApp(getPushToken: () => Promise<string | null>) {
  return render(
    <AppProviders>
      <PushRegistration getPushToken={getPushToken} />
      <SinhalaButton />
    </AppProviders>,
  );
}

beforeEach(() => {
  mockRouter.reset();
  mockTapListeners.length = 0;
  mockLastResponse = null;
});

describe('push registration', () => {
  it('registers a signed-in person’s phone, in the app’s language, and remembers it', async () => {
    await tokenStore.set(tokensFor('CAREGIVER'));
    const calls = serveApi({ 'POST /me/devices': () => ({ status: 200, body: { id: 'd-1' } }) });
    await showApp(async () => TOKEN);

    await waitFor(() => expect(calls.filter((c) => c.route === 'POST /me/devices')).toHaveLength(1));
    const call = calls.find((c) => c.route === 'POST /me/devices')!;
    expect(call.body).toMatchObject({ expoPushToken: TOKEN, platform: 'ios', locale: 'en' });
    expect(call.headers.Authorization).toMatch(/^Bearer /);
    await waitFor(async () => expect(await AsyncStorage.getItem(DEVICE_ID_KEY)).toBe('d-1'));
  });

  it('registers again in the new language when the person switches it, so pushes come in that language', async () => {
    await tokenStore.set(tokensFor('PATIENT_GUARDIAN'));
    const calls = serveApi({ 'POST /me/devices': () => ({ status: 200, body: { id: 'd-1' } }) });
    await showApp(async () => TOKEN);
    await waitFor(() => expect(calls.filter((c) => c.route === 'POST /me/devices')).toHaveLength(1));

    await fireEvent.press(screen.getByText('සිංහල'));
    await waitFor(() => expect(calls.filter((c) => c.route === 'POST /me/devices')).toHaveLength(2));
    expect(calls.filter((c) => c.route === 'POST /me/devices')[1].body.locale).toBe('si');
  });

  it('does nothing for someone who isn’t signed in, and forgets the phone’s id', async () => {
    await AsyncStorage.setItem(DEVICE_ID_KEY, 'd-old');
    const calls = serveApi({});
    const getToken = jest.fn(async () => TOKEN);
    await showApp(getToken);
    await waitFor(async () => expect(await AsyncStorage.getItem(DEVICE_ID_KEY)).toBeNull());
    expect(getToken).not.toHaveBeenCalled();
    expect(calls.some((c) => c.route === 'POST /me/devices')).toBe(false);
  });

  it('carries on without push when the person says no to notifications', async () => {
    await tokenStore.set(tokensFor('CAREGIVER'));
    const calls = serveApi({});
    const getToken = jest.fn(async () => null);
    await showApp(getToken);
    await waitFor(() => expect(getToken).toHaveBeenCalled());
    expect(calls.some((c) => c.route === 'POST /me/devices')).toBe(false);
  });
});

describe('tapping a notification', () => {
  it('opens the app on the screen it is about', async () => {
    serveApi({});
    await showApp(async () => null);
    await act(async () => mockTapListeners.forEach((fn) => fn(tap('/bookings/b-1'))));
    // A booking notice opens the Bookings tab.
    expect(mockRouter.push).toHaveBeenCalledWith('/bookings');
  });

  it('opens it too when the tap started the app', async () => {
    mockLastResponse = tap('/home');
    serveApi({});
    await showApp(async () => null);
    // It waits a tick for the navigator to mount.
    await act(() => new Promise((r) => setTimeout(r, 50)));
    expect(mockRouter.push).toHaveBeenCalledWith('/home');
    expect(mockNotifications.clearLastNotificationResponseAsync).toHaveBeenCalled();
  });
});

describe('where push works', () => {
  it('needs the Expo project id, which comes with the build setup', () => {
    const { pushSupported } = jest.requireActual('../src/push/notifications');
    expect(pushSupported()).toBe(false);
  });

  it('opens the screen a notice is about, and only screens the app has', () => {
    const { screenFor } = jest.requireActual('../src/push/notifications');
    expect(screenFor('/home')).toBe('/home');
    expect(screenFor('/bookings/b-1')).toBe('/bookings');
    expect(screenFor('/care')).toBe('/bookings');
    expect(screenFor('/requests/r-1')).toBe('/requests');
    expect(screenFor('/bookings/b-1/../../admin')).toBe('/home');
    expect(screenFor('/invoices/9')).toBe('/home');
    expect(screenFor(undefined)).toBe('/home');
  });
});
