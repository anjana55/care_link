'use client';

import { useEffect, useMemo, useState } from 'react';
import { COUNTRY_CODES, type CountryCode } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n';

/**
 * Country names in the visitor's language, from the browser (Intl.DisplayNames
 * knows Sinhala and Tamil), so the list never has to be translated by hand.
 * Falls back to the code where a browser has no name for it.
 *
 * Names are only looked up after mount: the server's ICU data and the
 * browser's disagree on some names ("Hong Kong" vs "Hong Kong SAR China"),
 * which would otherwise be a hydration mismatch on every country list.
 */
export function useCountryNames() {
  const { locale } = useTranslation();
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return useMemo(() => {
    let names: Intl.DisplayNames | null = null;
    try {
      names = mounted ? new Intl.DisplayNames([locale, 'en'], { type: 'region' }) : null;
    } catch {
      names = null;
    }
    const name = (code: string) => {
      try {
        return names?.of(code) ?? code;
      } catch {
        return code;
      }
    };
    const sorted = [...COUNTRY_CODES]
      .filter((c) => c !== 'LK')
      .map((code) => ({ code: code as CountryCode, name: name(code) }))
      .sort((a, b) => a.name.localeCompare(b.name, locale));
    return { name, sorted };
  }, [locale, mounted]);
}
