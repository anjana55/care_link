import { Pressable, StyleSheet, View } from 'react-native';
import { useTranslation, type Locale } from '@/i18n';
import { useColors } from '@/theme';
import { Text } from './Text';

/** Each language in its own script - the one label every reader can find. */
export const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', si: 'සිංහල', ta: 'தமிழ்' };

/** The deployment's languages as one-tap choices. Nothing when only one is offered. `onBrand` for the brand band. */
export function LanguagePicker({ onBrand = false }: { onBrand?: boolean }) {
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
              onBrand
                ? { borderColor: colors.surface, backgroundColor: selected ? colors.surface : 'rgba(0, 0, 0, 0.14)' }
                : [{ borderColor: colors.border, backgroundColor: colors.surface }, selected && { backgroundColor: colors.deep, borderColor: colors.deep }],
            ]}
          >
            <Text
              lang={code}
              style={[
                styles.text,
                { color: onBrand ? colors.brandText : colors.ink },
                selected && { color: onBrand ? colors.deep : colors.brandText, fontWeight: '700' },
              ]}
            >
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
  chip: { flexGrow: 1, minHeight: 52, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', borderRadius: 16, borderWidth: 2 },
  text: { fontSize: 17 },
});
