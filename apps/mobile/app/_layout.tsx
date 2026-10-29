import { useEffect, type ReactNode } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { I18nProvider, useTranslation } from '@/i18n';

// Kept up until the saved language has loaded, so a Sinhala or Tamil reader
// never sees the English default flash past on launch.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

function HideSplashWhenReady({ children }: { children: ReactNode }) {
  const { ready } = useTranslation();
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);
  return ready ? children : null;
}

export default function RootLayout() {
  return (
    // Known insets on the first frame, instead of a blank one while they are measured.
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <I18nProvider>
        <HideSplashWhenReady>
          <StatusBar style="auto" />
          <Stack screenOptions={{ headerShown: false }} />
        </HideSplashWhenReady>
      </I18nProvider>
    </SafeAreaProvider>
  );
}
