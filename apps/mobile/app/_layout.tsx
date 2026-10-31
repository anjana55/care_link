import { useEffect, useState, type ReactNode } from 'react';
import { Stack } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { useFonts } from 'expo-font';
import { QueryClientProvider } from '@tanstack/react-query';
import { SafeAreaProvider, initialWindowMetrics } from 'react-native-safe-area-context';
import { I18nProvider, useTranslation } from '@/i18n';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { BrandingProvider, useBranding } from '@/branding/BrandingProvider';
import { FONT_ASSETS } from '@/ui/fonts';
import { createQueryClient } from '@/api/query-client';
import { PushRegistration } from '@/push/PushRegistration';
import { UpdateGate } from '@/app-config/UpdateGate';

// Kept up until the saved language, the session and the fonts are all ready,
// so nobody sees an English or signed-out flash, or Sinhala in a fallback font.
SplashScreen.preventAutoHideAsync().catch(() => undefined);

/** Languages and the `{brand}` placeholder come from the deployment's branding. */
function BrandedI18n({ children }: { children: ReactNode }) {
  const { branding } = useBranding();
  return (
    <I18nProvider
      defaultLocale={branding.defaultLocale}
      enabledLocales={branding.enabledLocales}
      vars={{ brand: branding.companyName }}
    >
      {children}
    </I18nProvider>
  );
}

function ShowWhenReady({ children }: { children: ReactNode }) {
  const { ready: languageReady } = useTranslation();
  const { ready: sessionReady } = useAuth();
  // A font that fails to load falls back to the system font rather than holding the app.
  const [fontsLoaded, fontError] = useFonts(FONT_ASSETS);
  const ready = languageReady && sessionReady && (fontsLoaded || fontError !== null);
  useEffect(() => {
    if (ready) SplashScreen.hideAsync().catch(() => undefined);
  }, [ready]);
  return ready ? children : null;
}

export default function RootLayout() {
  const [queryClient] = useState(createQueryClient);
  return (
    // Known insets on the first frame, instead of a blank one while they are measured.
    <SafeAreaProvider initialMetrics={initialWindowMetrics}>
      <QueryClientProvider client={queryClient}>
        <BrandingProvider>
          <BrandedI18n>
            <AuthProvider>
              <ShowWhenReady>
                <StatusBar style="auto" />
                <PushRegistration />
                <UpdateGate>
                  <Stack screenOptions={{ headerShown: false }} />
                </UpdateGate>
              </ShowWhenReady>
            </AuthProvider>
          </BrandedI18n>
        </BrandingProvider>
      </QueryClientProvider>
    </SafeAreaProvider>
  );
}
