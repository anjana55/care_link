import { useMemo, useState } from 'react';
import { Link, Redirect } from 'expo-router';
import { Image, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation } from '@/i18n';
import { homeFor } from '@/auth/sides';
import { LanguagePicker } from '@/ui/LanguagePicker';
import { useBranding } from '@/branding/BrandingProvider';
import { useAuth } from '@/auth/AuthProvider';
import { useColors, type Colors } from '@/theme';
import { Text } from '@/ui/Text';

/**
 * First screen: language, then which side of the app this person is on.
 * The choice decides the registration endpoint and the `portal` sent on
 * sign-in (caregiver or customer), so the API's portal rule still applies.
 */
export default function Welcome() {
  const { t } = useTranslation();
  const { branding, logoUrl } = useBranding();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // React Native can't draw an SVG logo (the API accepts them): fall back to the name.
  const [logoFailed, setLogoFailed] = useState(false);
  const { user } = useAuth();

  // Already signed in: straight to their area.
  if (user) return <Redirect href={homeFor(user)} />;

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        {logoUrl && !logoFailed ? (
          <Image
            source={{ uri: logoUrl }}
            style={styles.logo}
            resizeMode="contain"
            accessibilityLabel={branding.companyName}
            onError={() => setLogoFailed(true)}
          />
        ) : (
          <Text style={styles.appName}>{t('app.name')}</Text>
        )}
        <Text style={styles.tagline}>{t('welcome.tagline')}</Text>
      </View>

      <LanguagePicker />

      <View style={styles.actions}>
        {/* Searching needs no account: a client signs in when they contact or save someone. */}
        <Link href="/find" asChild>
          <Pressable accessibilityRole="button" style={styles.primaryButton}>
            <Text style={[styles.buttonText, styles.primaryText]}>{t('welcome.findCare')}</Text>
          </Pressable>
        </Link>
        <Link href={{ pathname: '/sign-in', params: { role: 'caregiver' } }} asChild>
          <Pressable accessibilityRole="button" style={styles.secondaryButton}>
            <Text style={styles.buttonText}>{t('welcome.joinAsCaregiver')}</Text>
          </Pressable>
        </Link>

        <View style={styles.signIn}>
          <Text style={styles.signInLead}>{t('welcome.haveAccount')}</Text>
          <Link href={{ pathname: '/sign-in', params: { role: 'client' } }} asChild>
            <Pressable accessibilityRole="link" style={styles.signInLink}>
              <Text style={styles.signInText}>{t('signIn.client')}</Text>
            </Pressable>
          </Link>
          <Link href={{ pathname: '/sign-in', params: { role: 'caregiver' } }} asChild>
            <Pressable accessibilityRole="link" style={styles.signInLink}>
              <Text style={styles.signInText}>{t('signIn.caregiver')}</Text>
            </Pressable>
          </Link>
        </View>
      </View>
    </SafeAreaView>
  );
}

const button = { minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 } as const;

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 24, justifyContent: 'space-between' },
    header: { marginTop: 72, gap: 12 },
    logo: { width: 180, height: 56, alignSelf: 'flex-start' },
    appName: { fontSize: 34, fontWeight: '700', color: colors.brand },
    tagline: { fontSize: 22, lineHeight: 34, color: colors.ink },
    actions: { gap: 12, marginBottom: 32 },
    // One flat style each: expo-router's <Link asChild> refuses an array of styles on its child.
    primaryButton: { ...button, backgroundColor: colors.brand },
    secondaryButton: { ...button, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brand },
    buttonText: { fontSize: 17, fontWeight: '600', color: colors.brand, textAlign: 'center' },
    primaryText: { color: colors.brandText },
    signIn: { marginTop: 12, alignItems: 'center' },
    signInLead: { fontSize: 15, color: colors.muted },
    signInLink: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
    signInText: { fontSize: 17, fontWeight: '600', color: colors.brand, textDecorationLine: 'underline' },
  });
