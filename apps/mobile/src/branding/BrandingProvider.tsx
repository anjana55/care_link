import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useQuery } from '@tanstack/react-query';
import { DEFAULT_BRANDING, brandingAssetUrl, normalizeBranding, type BrandAsset, type BRAND_PNG_SIZES, type PublicBranding } from '@care-platform/shared';
import { api } from '@/api';
import { config } from '@/config';

/**
 * The deployment's own name, colours, logo and languages (Settings > Branding),
 * read from GET /branding - so an admin's change reaches the app without a new
 * build. The last answer is kept on the phone and used first, so the right name
 * and colours show from the first frame and with no signal.
 */
const CACHE_KEY = 'carelink.branding';

type PngSize = (typeof BRAND_PNG_SIZES)[number];

interface BrandingValue {
  branding: PublicBranding;
  /** The logo as a PNG (the app can't draw SVG), or null when the deployment has none. */
  logoUrl: string | null;
  /**
   * A piece of the brand's artwork (Settings > Branding) as a PNG `size` px on
   * its longer side - ask for twice the size it is drawn at, for sharp screens -
   * or null when it isn't uploaded.
   */
  assetUrl(asset: BrandAsset, size: PngSize): string | null;
}

const BrandingContext = createContext<BrandingValue | null>(null);

export function BrandingProvider({
  children,
  fetchBranding = () => api.get<PublicBranding>('/branding'),
}: {
  children: ReactNode;
  /** For tests. */
  fetchBranding?: () => Promise<PublicBranding>;
}) {
  const [cached, setCached] = useState<PublicBranding | null>(null);

  useEffect(() => {
    AsyncStorage.getItem(CACHE_KEY)
      .then((raw) => raw && setCached(JSON.parse(raw) as PublicBranding))
      .catch(() => undefined);
  }, []);

  const { data } = useQuery({
    queryKey: ['branding'],
    queryFn: fetchBranding,
    staleTime: 5 * 60 * 1000,
    retry: 1,
  });

  useEffect(() => {
    if (data) AsyncStorage.setItem(CACHE_KEY, JSON.stringify(data)).catch(() => undefined);
  }, [data]);

  const value = useMemo<BrandingValue>(() => {
    // Normalised: a copy saved by an older version of the app has no `assets`.
    const raw = data ?? cached;
    const branding = raw ? normalizeBranding(raw) : { ...DEFAULT_BRANDING, companyName: config.brandName };
    const assetUrl = (asset: BrandAsset, size: PngSize) => brandingAssetUrl(config.apiUrl, branding, asset, { png: size });
    return { branding, logoUrl: assetUrl('logo', 512), assetUrl };
  }, [data, cached]);

  return <BrandingContext.Provider value={value}>{children}</BrandingContext.Provider>;
}

export function useBranding(): BrandingValue {
  const ctx = useContext(BrandingContext);
  if (!ctx) throw new Error('useBranding must be used within BrandingProvider');
  return ctx;
}
