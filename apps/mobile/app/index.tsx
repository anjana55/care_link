import { Link } from 'expo-router';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useTranslation, type Locale } from '@/i18n';
import { colors } from '@/theme';

/** Each language in its own script - the one label every reader can find. */
const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', si: 'සිංහල', ta: 'தமிழ்' };

/**
 * First screen: language, then which side of the app this person is on.
 * The choice decides the registration endpoint and the `portal` sent on
 * sign-in (caregiver or customer), so the API's portal rule still applies.
 */
export default function Welcome() {
  const { t, locale, setLocale, availableLocales } = useTranslation();

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        <Text style={styles.appName}>{t('app.name')}</Text>
        <Text style={styles.tagline}>{t('welcome.tagline')}</Text>
      </View>

      {availableLocales.length > 1 && (
        <View accessibilityRole="radiogroup" accessibilityLabel={t('welcome.language')} style={styles.languages}>
          {availableLocales.map((code) => {
            const selected = code === locale;
            return (
              <Pressable
                key={code}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                onPress={() => setLocale(code)}
                style={[styles.language, selected && styles.languageSelected]}
              >
                <Text style={[styles.languageText, selected && styles.languageTextSelected]}>{LANGUAGE_NAMES[code]}</Text>
              </Pressable>
            );
          })}
        </View>
      )}

      <View style={styles.actions}>
        <Link href={{ pathname: '/sign-in', params: { role: 'client' } }} asChild>
          <Pressable accessibilityRole="button" style={[styles.button, styles.primary]}>
            <Text style={[styles.buttonText, styles.primaryText]}>{t('welcome.findCare')}</Text>
          </Pressable>
        </Link>
        <Link href={{ pathname: '/sign-in', params: { role: 'caregiver' } }} asChild>
          <Pressable accessibilityRole="button" style={[styles.button, styles.secondary]}>
            <Text style={styles.buttonText}>{t('welcome.joinAsCaregiver')}</Text>
          </Pressable>
        </Link>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.background, paddingHorizontal: 24, justifyContent: 'space-between' },
  header: { marginTop: 72, gap: 12 },
  appName: { fontSize: 34, fontWeight: '700', color: colors.brand },
  tagline: { fontSize: 22, lineHeight: 32, color: colors.ink },
  languages: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  language: {
    minHeight: 44,
    paddingHorizontal: 16,
    justifyContent: 'center',
    borderRadius: 22,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.surface,
  },
  languageSelected: { backgroundColor: colors.brand, borderColor: colors.brand },
  languageText: { fontSize: 16, color: colors.ink },
  languageTextSelected: { color: colors.brandText, fontWeight: '600' },
  actions: { gap: 12, marginBottom: 32 },
  button: { minHeight: 52, borderRadius: 12, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 16 },
  primary: { backgroundColor: colors.brand },
  secondary: { backgroundColor: colors.surface, borderWidth: 1, borderColor: colors.brand },
  buttonText: { fontSize: 17, fontWeight: '600', color: colors.brand, textAlign: 'center' },
  primaryText: { color: colors.brandText },
});
