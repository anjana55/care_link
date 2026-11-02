import { useMemo } from 'react';
import { Link, Redirect } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import Ionicons from '@expo/vector-icons/Ionicons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useTranslation } from '@/i18n';
import { homeFor } from '@/auth/sides';
import { LanguagePicker } from '@/ui/LanguagePicker';
import { useAuth } from '@/auth/AuthProvider';
import { useColors, type Colors } from '@/theme';
import { Text } from '@/ui/Text';
import { BrandLogo, BrandMark, HeroBand, IconBadge } from '@/ui/visual';

/**
 * First screen: language, then which side of the app this person is on.
 * The choice decides the registration endpoint and the `portal` sent on
 * sign-in (caregiver or customer), so the API's portal rule still applies.
 */
export default function Welcome() {
  const { t } = useTranslation();
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const insets = useSafeAreaInsets();
  const { user } = useAuth();

  // Already signed in: straight to their area.
  if (user) return <Redirect href={homeFor(user)} />;

  return (
    <ScrollView style={styles.screen} contentContainerStyle={{ paddingBottom: insets.bottom + 24 }} bounces={false}>
      <HeroBand style={{ paddingTop: insets.top + 28 }}>
        <View style={styles.header}>
          <BrandLogo reverse height={44} name={t('app.name')} />
          <Text style={styles.tagline}>{t('welcome.tagline')}</Text>
        </View>

        {/* A small picture of what the app is for: care, people, home. */}
        <View style={styles.art} importantForAccessibility="no-hide-descendants" accessibilityElementsHidden>
          <View style={styles.artCircle}>
            <Ionicons name="home-outline" size={26} color={colors.brandText} />
          </View>
          {/* The brand's own symbol in the middle (Settings > Branding), else a heart. */}
          <View style={styles.artCircleMain}>
            <BrandMark size={72} light />
          </View>
          <View style={styles.artCircle}>
            <Ionicons name="people-outline" size={26} color={colors.brandText} />
          </View>
        </View>

        <LanguagePicker onBrand />
      </HeroBand>

      <View style={styles.actions}>
        {/* Searching needs no account: a client signs in when they contact or save someone. */}
        <Link href="/find" asChild>
          <Pressable accessibilityRole="button" accessibilityLabel={t('welcome.findCare')} style={styles.primaryCard}>
            <View style={styles.cardIconOnBrand}>
              <Ionicons name="search" size={24} color={colors.brand} />
            </View>
            <View style={styles.cardText}>
              <Text style={[styles.cardTitle, styles.primaryText]}>{t('welcome.findCare')}</Text>
              <Text style={[styles.cardHint, styles.primaryHint]}>{t('welcome.findCareHint')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={colors.brandText} />
          </Pressable>
        </Link>
        <Link href={{ pathname: '/sign-in', params: { role: 'caregiver' } }} asChild>
          <Pressable accessibilityRole="button" accessibilityLabel={t('welcome.joinAsCaregiver')} style={styles.secondaryCard}>
            <IconBadge name="medkit-outline" tone="accent" size={48} />
            <View style={styles.cardText}>
              <Text style={styles.cardTitle}>{t('welcome.joinAsCaregiver')}</Text>
              <Text style={styles.cardHint}>{t('welcome.joinHint')}</Text>
            </View>
            <Ionicons name="chevron-forward" size={22} color={colors.muted} />
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

const card = { minHeight: 84, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 16, paddingVertical: 14 } as const;

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, backgroundColor: colors.background },
    header: { gap: 14 },
    tagline: { fontSize: 24, lineHeight: 34, color: colors.brandText, fontWeight: '600' },
    art: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 18, marginVertical: 26 },
    artCircle: { width: 60, height: 60, borderRadius: 30, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255, 255, 255, 0.16)' },
    artCircleMain: { width: 96, height: 96, borderRadius: 48, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    actions: { gap: 14, paddingHorizontal: 20, marginTop: 24 },
    // One flat style each: expo-router's <Link asChild> refuses an array of styles on its child.
    primaryCard: { ...card, backgroundColor: colors.brand },
    secondaryCard: { ...card, backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.border },
    cardIconOnBrand: { width: 48, height: 48, borderRadius: 24, backgroundColor: colors.surface, alignItems: 'center', justifyContent: 'center' },
    cardText: { flex: 1, gap: 3 },
    cardTitle: { fontSize: 18, fontWeight: '700', color: colors.ink },
    cardHint: { fontSize: 14, lineHeight: 20, color: colors.muted },
    primaryText: { color: colors.brandText },
    primaryHint: { color: 'rgba(255, 255, 255, 0.85)' },
    signIn: { marginTop: 10, alignItems: 'center' },
    signInLead: { fontSize: 15, color: colors.muted },
    signInLink: { minHeight: 44, justifyContent: 'center', paddingHorizontal: 8 },
    signInText: { fontSize: 17, fontWeight: '600', color: colors.brand, textDecorationLine: 'underline' },
  });
