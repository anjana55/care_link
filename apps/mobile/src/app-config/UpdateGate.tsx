import { useEffect, useState, type ReactNode } from 'react';
import { Linking, Platform, StyleSheet, View } from 'react-native';
import Constants from 'expo-constants';
import * as Application from 'expo-application';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { appUpdateStatus, normalizeAppConfig } from '@care-platform/shared';
import { api } from '@/api';
import { useTranslation } from '@/i18n';
import { useColors } from '@/theme';
import { Button, Screen } from '@/ui/controls';
import { Text } from '@/ui/Text';

export const DISMISSED_KEY = 'update.dismissedVersion';

/** This build's store version (1.2.0), as the stores know it. */
export function installedVersion(): string | null {
  return Application.nativeApplicationVersion ?? Constants.expoConfig?.version ?? null;
}

interface Props {
  children: ReactNode;
  /** For tests. */
  version?: string | null;
}

/**
 * Checks this build against Settings > Mobile app (GET /public/app-config)
 * every time the app opens. Below the minimum, the app stops at an "update"
 * screen; below the latest, it offers an update once per new version and
 * carries on. While the check is loading, offline or failing, the app simply
 * works: only a clear answer ever blocks anyone.
 */
export function UpdateGate({ children, version = installedVersion() }: Props) {
  const { t } = useTranslation();
  const colors = useColors();
  const { data } = useQuery({
    queryKey: ['app-config'],
    queryFn: async () => normalizeAppConfig(await api.request('/public/app-config', { anonymous: true })),
    staleTime: 0,
    retry: 1,
  });
  const platform = Platform.OS === 'ios' ? 'ios' : 'android';
  const config = data?.[platform];
  const status = config ? appUpdateStatus(version, config) : 'current';
  const storeUrl = config?.storeUrl ?? null;

  // "Not now" is remembered for this latest version only, so the next release asks again.
  const [dismissed, setDismissed] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    AsyncStorage.getItem(DISMISSED_KEY)
      .then((v) => setDismissed(v))
      .catch(() => setDismissed(null));
  }, []);

  const openStore = () => {
    if (storeUrl) Linking.openURL(storeUrl).catch(() => undefined);
  };

  if (status === 'required') {
    return (
      <Screen>
        <View style={styles.required}>
          <Text accessibilityRole="header" style={[styles.title, { color: colors.ink }]}>
            {t('update.requiredTitle')}
          </Text>
          <Text style={[styles.body, { color: colors.muted }]}>{t('update.requiredBody')}</Text>
          {storeUrl ? <Button label={t('update.update')} onPress={openStore} /> : null}
        </View>
      </Screen>
    );
  }

  const offer = status === 'available' && storeUrl && dismissed !== undefined && dismissed !== config?.latestVersion;
  return (
    <>
      {children}
      {offer ? (
        <View accessibilityRole="alert" style={[styles.offer, { backgroundColor: colors.surface, borderColor: colors.border }]}>
          <Text style={[styles.offerTitle, { color: colors.ink }]}>{t('update.availableTitle')}</Text>
          <Text style={{ color: colors.muted, fontSize: 15, lineHeight: 22 }}>{t('update.availableBody')}</Text>
          <View style={styles.offerActions}>
            <View style={{ flex: 1 }}>
              <Button label={t('update.update')} onPress={openStore} />
            </View>
            <View style={{ flex: 1 }}>
              <Button
                variant="secondary"
                label={t('update.notNow')}
                onPress={() => {
                  const v = config?.latestVersion ?? null;
                  setDismissed(v);
                  if (v) AsyncStorage.setItem(DISMISSED_KEY, v).catch(() => undefined);
                }}
              />
            </View>
          </View>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  required: { flex: 1, justifyContent: 'center', gap: 16 },
  title: { fontSize: 26, lineHeight: 36, fontWeight: '700' },
  body: { fontSize: 17, lineHeight: 26 },
  offer: { position: 'absolute', left: 16, right: 16, bottom: 32, padding: 16, gap: 8, borderRadius: 16, borderWidth: 1, elevation: 6, shadowColor: '#000', shadowOpacity: 0.15, shadowRadius: 12, shadowOffset: { width: 0, height: 4 } },
  offerTitle: { fontSize: 17, fontWeight: '700' },
  offerActions: { flexDirection: 'row', gap: 12, marginTop: 4 },
});
