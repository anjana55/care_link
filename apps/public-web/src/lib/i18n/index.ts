'use client';

import { createI18n } from '@care-platform/shared/i18n';
import { DEFAULT_COMPANY_NAME } from '@care-platform/shared';
import en from './dictionaries/en.json';
import si from './dictionaries/si.json';
import ta from './dictionaries/ta.json';

// `{brand}` in the dictionaries is the company name; BrandingProvider passes the configured one.
export const { I18nProvider, useTranslation } = createI18n({ en, si, ta }, 'care-platform-public-locale', { brand: DEFAULT_COMPANY_NAME });
export { SUPPORTED_LOCALES, type Locale } from '@care-platform/shared/i18n';
