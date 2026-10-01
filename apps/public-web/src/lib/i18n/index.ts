'use client';

import { createI18n } from '@care-platform/shared/i18n';
import en from './dictionaries/en.json';
import si from './dictionaries/si.json';
import ta from './dictionaries/ta.json';

export const { I18nProvider, useTranslation } = createI18n({ en, si, ta }, 'care-platform-public-locale');
export { SUPPORTED_LOCALES, type Locale } from '@care-platform/shared/i18n';
