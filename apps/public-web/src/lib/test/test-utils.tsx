import { ReactNode } from 'react';
import { I18nProvider } from '@/lib/i18n';

export function renderWithProviders(children: ReactNode) {
  return <I18nProvider>{children}</I18nProvider>;
}
