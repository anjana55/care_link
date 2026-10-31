// One import per weight: the packages' index pulls in all nine weights of each
// typeface (~4 MB) when the app uses two.
import { NotoSansSinhala_400Regular } from '@expo-google-fonts/noto-sans-sinhala/400Regular';
import { NotoSansSinhala_700Bold } from '@expo-google-fonts/noto-sans-sinhala/700Bold';
import { NotoSansTamil_400Regular } from '@expo-google-fonts/noto-sans-tamil/400Regular';
import { NotoSansTamil_700Bold } from '@expo-google-fonts/noto-sans-tamil/700Bold';
import type { Locale } from '@care-platform/shared/i18n';

/**
 * Sinhala and Tamil in the same typeface on every phone. Phones do ship system
 * fonts for both, but they vary by maker and Android version - some render
 * conjuncts badly or not at all - so the app bundles Noto, as the website does.
 * English uses the system font.
 */
export const FONT_ASSETS = {
  NotoSansSinhala_400Regular,
  NotoSansSinhala_700Bold,
  NotoSansTamil_400Regular,
  NotoSansTamil_700Bold,
};

const FAMILIES: Record<Locale, { regular?: string; bold?: string }> = {
  en: {},
  si: { regular: 'NotoSansSinhala_400Regular', bold: 'NotoSansSinhala_700Bold' },
  ta: { regular: 'NotoSansTamil_400Regular', bold: 'NotoSansTamil_700Bold' },
};

/**
 * The font family for this locale and weight. A custom font has one family per
 * weight, so a bold heading needs the bold file rather than fontWeight alone.
 */
export function fontFamilyFor(locale: Locale, bold: boolean): string | undefined {
  const family = FAMILIES[locale];
  return bold ? family.bold : family.regular;
}
