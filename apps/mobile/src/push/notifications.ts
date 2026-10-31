import { Platform } from 'react-native';
import Constants from 'expo-constants';
import * as Device from 'expo-device';
import { isRunningInExpoGo } from 'expo';

type NotificationsModule = typeof import('expo-notifications');

/**
 * Push needs a real phone, and an Expo project id (set with EAS in Phase 1d).
 * Expo Go on Android can't receive push at all since SDK 53, so the module
 * isn't even loaded there - it would only log an error. Everything else in
 * the app works the same without push.
 */
export function pushSupported(): boolean {
  if (!Device.isDevice) return false;
  if (Platform.OS === 'android' && isRunningInExpoGo()) return false;
  return Boolean(projectId());
}

export function projectId(): string | undefined {
  const extra = Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined;
  return extra?.eas?.projectId ?? Constants.easConfig?.projectId ?? undefined;
}

let loaded: NotificationsModule | null | undefined;

/** expo-notifications, or null where push can't work (see pushSupported). */
export function notifications(): NotificationsModule | null {
  if (loaded === undefined) {
    loaded = pushSupported() ? (require('expo-notifications') as NotificationsModule) : null;
    if (loaded) configure(loaded);
  }
  return loaded;
}

function configure(n: NotificationsModule) {
  // A push that arrives while the app is open still shows, as it would outside it.
  n.setNotificationHandler({
    handleNotification: async () => ({ shouldShowBanner: true, shouldShowList: true, shouldPlaySound: true, shouldSetBadge: false }),
  });
  // The API sends to this channel (channelId "default"); Android needs it to exist.
  if (Platform.OS === 'android') {
    n.setNotificationChannelAsync('default', { name: 'Notifications', importance: n.AndroidImportance.HIGH }).catch(() => undefined);
  }
}

/**
 * This phone's Expo push token, asking for permission if it hasn't been
 * answered yet. Null when push isn't available or the person said no - never
 * throws, because push is always an extra.
 */
export async function getPushToken(): Promise<string | null> {
  const n = notifications();
  if (!n) return null;
  try {
    let { status } = await n.getPermissionsAsync();
    if (status !== 'granted') ({ status } = await n.requestPermissionsAsync());
    if (status !== 'granted') return null;
    const { data } = await n.getExpoPushTokenAsync({ projectId: projectId() });
    return data;
  } catch {
    return null;
  }
}

/**
 * Where a tapped notification goes. The API sends the screen it is about
 * (/bookings/{id}, /care, /requests/{id}, /shifts, /invoices/{id}, ...).
 * Bookings and the 8 pm care reminder open Bookings, requests open My
 * requests; the rest open home (a client's home is Find) until their screens
 * exist (2d, Phase 3).
 */
const SCREENS: [RegExp, string][] = [
  [/^\/(bookings(\/[^/]+)?|care)$/, '/bookings'],
  [/^\/requests(\/[^/]+)?$/, '/requests'],
];
export function screenFor(path: unknown): string {
  if (typeof path !== 'string') return '/home';
  return SCREENS.find(([re]) => re.test(path))?.[1] ?? '/home';
}
