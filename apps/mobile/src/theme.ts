import { useMemo } from 'react';
import { useBranding } from '@/branding/BrandingProvider';

/**
 * Colours. The brand and accent come from the deployment's branding (the API
 * only accepts colours that keep white text readable on them - WCAG AA); the
 * neutrals are the app's own.
 */
const neutrals = {
  brandText: '#FFFFFF',
  ink: '#111827',
  muted: '#4B5563',
  border: '#D1D5DB',
  surface: '#FFFFFF',
  background: '#F8FAFC',
} as const;

export type Colors = typeof neutrals & { brand: string; accent: string };

export function useColors(): Colors {
  const { branding } = useBranding();
  return useMemo(() => ({ ...neutrals, brand: branding.primaryColor, accent: branding.accentColor }), [branding]);
}
