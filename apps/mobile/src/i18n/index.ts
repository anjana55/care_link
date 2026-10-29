import AsyncStorage from '@react-native-async-storage/async-storage';
import Constants from 'expo-constants';
import { createI18n, type Locale } from '@care-platform/shared/i18n';
import en from './en.json';
import si from './si.json';
import ta from './ta.json';

/**
 * The shared i18n engine (packages/shared/src/i18n), given what a phone has
 * instead of a browser: AsyncStorage for the saved language, and a hook in
 * place of <html lang>.
 *
 * The strings are copied verbatim from the public site's dictionaries, so the
 * Sinhala and Tamil are the reviewed translations rather than new ones.
 */

let currentLocale: Locale = 'en';

/**
 * The language to send the API (`lang=` / Accept-Language), so its messages -
 * errors included - come back in it. The web client reads localStorage on
 * every request; AsyncStorage can't be read synchronously, so the engine tells
 * us instead, and the API client will read this.
 */
export function currentLanguage(): Locale {
  return currentLocale;
}

const brandName = (Constants.expoConfig?.extra?.brandName as string | undefined) ?? 'CareLink';

export const { I18nProvider, useTranslation } = createI18n(
  { en, si, ta },
  'carelink-locale',
  { brand: brandName },
  {
    storage: AsyncStorage,
    onLocaleChange: (locale) => {
      currentLocale = locale;
    },
  },
);

export type { Locale };
