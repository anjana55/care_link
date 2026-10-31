import { StyleSheet, Text as RNText, type TextProps } from 'react-native';
import { useTranslation } from '@/i18n';
import { fontFamilyFor } from './fonts';

const BOLD = new Set(['bold', '600', '700', '800', '900']);

/**
 * Text in the reader's language and its font. Use this instead of React
 * Native's Text, so Sinhala and Tamil always get the bundled Noto fonts at the
 * right weight. `lang` overrides the reading language - for a language's own
 * name in the language picker.
 */
export function Text({ style, lang, ...props }: TextProps & { lang?: 'en' | 'si' | 'ta' }) {
  const { locale } = useTranslation();
  const flat = StyleSheet.flatten(style) ?? {};
  const bold = BOLD.has(String(flat.fontWeight ?? ''));
  const fontFamily = fontFamilyFor(lang ?? locale, bold);
  // With a per-weight font file the weight is in the family: drop fontWeight so
  // Android doesn't synthesise a second, smudged bold on top of it.
  return <RNText {...props} style={[style, fontFamily ? { fontFamily, fontWeight: 'normal' } : null]} />;
}
