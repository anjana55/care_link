import { useMemo } from 'react';
import { useBranding } from '@/branding/BrandingProvider';

/**
 * Colours. The brand and accent come from the deployment's branding (the API
 * only accepts colours that keep white text readable on them - WCAG AA); the
 * neutrals are the app's own.
 */
const neutrals = {
  brandText: '#FFFFFF',
  ink: '#1C2B36',
  muted: '#4A5A66',
  /** Deep navy: main buttons, the chosen day, the panel under a calendar - strong against any brand colour. */
  deep: '#12304A',
  danger: '#B91C1C',
  border: '#C9D6DC',
  surface: '#FFFFFF',
  background: '#F4F8F8',
} as const;

export type Colors = typeof neutrals & { brand: string; accent: string };

export function useColors(): Colors {
  const { branding } = useBranding();
  return useMemo(() => ({ ...neutrals, brand: branding.primaryColor, accent: branding.accentColor }), [branding]);
}
