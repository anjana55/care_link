import { useEffect } from 'react';
import { Platform } from 'react-native';
import Constants from 'expo-constants';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useRouter } from 'expo-router';
import { api as defaultApi } from '@/api';
import type { ApiClient } from '@/api/client';
import { useAuth } from '@/auth/AuthProvider';
import { useTranslation } from '@/i18n';
import { getPushToken as defaultGetPushToken, notifications, screenFor } from './notifications';

export const DEVICE_ID_KEY = 'push.deviceId';

interface Props {
  /** For tests. */
  api?: ApiClient;
  getPushToken?: () => Promise<string | null>;
}

/**
 * Registers this phone for push while someone is signed in, in the app's
 * language, and again whenever the language changes (pushes are written in
 * it). Signing out revokes it on the server (POST /auth/logout stops every
 * phone), so here it only forgets the id. Tapping a notification opens the
 * screen it is about. Renders nothing.
 */
export function PushRegistration({ api = defaultApi, getPushToken = defaultGetPushToken }: Props) {
  const { user } = useAuth();
  const { locale } = useTranslation();
  const router = useRouter();
  const userId = user?.userId ?? null;

  useEffect(() => {
    if (!userId) {
      AsyncStorage.removeItem(DEVICE_ID_KEY).catch(() => undefined);
      return;
    }
    let current = true;
    (async () => {
      const expoPushToken = await getPushToken();
      if (!expoPushToken || !current) return;
      const device = await api.post<{ id: string }>('/me/devices', {
        expoPushToken,
        platform: Platform.OS === 'ios' ? 'ios' : 'android',
        appVersion: Constants.expoConfig?.version,
        locale,
      });
      await AsyncStorage.setItem(DEVICE_ID_KEY, device.id);
    })().catch(() => undefined); // Push is an extra: no network now means it registers on the next start.
    return () => {
      current = false;
    };
  }, [userId, locale, api, getPushToken]);

  useEffect(() => {
    const n = notifications();
    if (!n) return;
    const open = (data: Record<string, unknown> | undefined) => router.push(screenFor(data?.path) as never);
    // A notification tapped while the app was closed...
    // (on the next tick, once the navigator below has mounted).
    const last = n.getLastNotificationResponse();
    const startup = last ? setTimeout(() => open(last.notification.request.content.data), 0) : undefined;
    if (last) n.clearLastNotificationResponseAsync().catch(() => undefined);
    // ...and while it is open or in the background.
    const sub = n.addNotificationResponseReceivedListener((r) => open(r.notification.request.content.data));
    return () => {
      clearTimeout(startup);
      sub.remove();
    };
  }, [router]);

  return null;
}
