import { useMemo } from 'react';
import { Link, Redirect } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from '@/i18n';
import { homeFor } from '@/auth/sides';
import { LanguagePicker } from '@/ui/LanguagePicker';
import { useAuth } from '@/auth/AuthProvider';
import { useColors, type Colors } from '@/theme';
import { Text } from '@/ui/Text';
import { CaregiversIllustration } from '@/ui/Illustration';
import { BrandLogo, tint } from '@/ui/visual';

/**
 * First screen, kept simple: the brand, the language, a picture of the people
 * the app is about, one sentence, and one button - Get started - which asks
 * which side of the app this person is on. People who already have an account
 * sign in straight from here.
 */
export default function Welcome() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { width } = useWindowDimensions();
  const { user } = useAuth();

  // Already signed in: straight to their area.
  if (user) return <Redirect href={homeFor(user)} />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} bounces={false}>
      <View testID="welcome-band" style={[styles.band, { paddingTop: insets.top + 20 }]}>
        <View pointerEvents="none" style={[styles.blob, { backgroundColor: tint(colors.accent, 0.45) }]} />
        <View style={styles.bandTop}>
          <BrandLogo reverse height={40} name={t('app.name')} />
          <LanguagePicker onBrand />
        </View>
        <View style={styles.art}>
          <CaregiversIllustration width={Math.min(width - 24, 380)} />
        </View>
      </View>

      <View style={styles.body}>
        <View style={{ gap: 10 }}>
          <Text accessibilityRole="header" style={styles.headline}>
            {t('welcome.headline')}
          </Text>
          <Text style={styles.subline}>{t('welcome.subline')}</Text>
        </View>

        <Link href="/get-started" asChild>
          <Pressable accessibilityRole="button" accessibilityLabel={t('welcome.getStarted')} style={styles.start}>
            <Text style={styles.startText}>{t('welcome.getStarted')}</Text>
            <Ionicons name="arrow-forward" size={26} color={colors.brandText} />
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
    </ScrollView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.surface },
    band: { backgroundColor: colors.brand, borderBottomLeftRadius: 48, borderBottomRightRadius: 48, overflow: 'hidden' },
    blob: { position: 'absolute', width: 260, height: 260, borderRadius: 130, top: -80, right: -80 },
    bandTop: { paddingHorizontal: 24, gap: 18 },
    art: { alignItems: 'center', marginTop: 12 },
    body: { paddingHorizontal: 24, paddingTop: 28, gap: 24 },
    headline: { fontSize: 30, lineHeight: 38, fontWeight: '800', color: colors.deep },
    subline: { fontSize: 18, lineHeight: 27, color: colors.muted },
    // One flat style each: expo-router's <Link asChild> refuses an array of styles on its child.
    start: { minHeight: 64, borderRadius: 18, backgroundColor: colors.deep, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 },
    startText: { fontSize: 22, fontWeight: '800', color: colors.brandText },
    signIn: { alignItems: 'center' },
    signInLead: { fontSize: 17, color: colors.muted },
    signInLink: { minHeight: 48, justifyContent: 'center', paddingHorizontal: 8 },
    signInText: { fontSize: 18, fontWeight: '700', color: colors.brand, textDecorationLine: 'underline' },
  });
