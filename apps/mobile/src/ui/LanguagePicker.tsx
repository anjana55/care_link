import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation, type Locale } from '@/i18n';
import { useColors } from '@/theme';
import { Text } from './Text';

/** Each language in its own script - the one label every reader can find. */
export const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', si: 'සිංහල', ta: 'தமிழ்' };

/** The deployment's languages as one-tap choices. Nothing when only one is offered. */
export function LanguagePicker() {
  const { t, locale, setLocale, availableLocales } = useTranslation();
  const colors = useColors();
  if (availableLocales.length < 2) return null;
  return (
    <View accessibilityRole="radiogroup" accessibilityLabel={t('welcome.language')} style={styles.row}>
      {availableLocales.map((code) => {
        const selected = code === locale;
        return (
          <Pressable
            key={code}
            accessibilityRole="radio"
            accessibilityState={{ selected }}
            onPress={() => setLocale(code)}
            style={[
              styles.chip,
              { borderColor: colors.border, backgroundColor: colors.surface },
              selected && { backgroundColor: colors.brand, borderColor: colors.brand },
            ]}
          >
            <Text lang={code} style={[styles.text, { color: colors.ink }, selected && { color: colors.brandText, fontWeight: '600' }]}>
              {LANGUAGE_NAMES[code]}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  chip: { minHeight: 44, paddingHorizontal: 16, justifyContent: 'center', borderRadius: 22, borderWidth: 1 },
  text: { fontSize: 16 },
});
