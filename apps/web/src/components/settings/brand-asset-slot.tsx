'use client';

import { useRef, useState } from 'react';
import { ImageUp, Trash2 } from 'lucide-react';
import { LOGO_MAX_BYTES, LOGO_MIME_TYPES, brandingAssetUrl, type BrandAsset } from '@care-platform/shared';
import { useTranslation } from '@/lib/i18n/provider';
import { ApiError } from '@/lib/api/client';
import { useRemoveBrandAsset, useUploadBrandAsset, type BrandingSettings } from '@/lib/hooks/use-branding-settings';
import { Button } from '@/components/ui/button';

/**
 * One piece of the brand's artwork in Settings > Branding: what it is, where
 * it shows, what to upload - and the current file, shown on the background
 * it will sit on (the reverse logo on the brand colour, the app icon in a
 * phone's rounded mask).
 */
export function BrandAssetSlot({
  asset,
  settings,
  apiUrl,
  primaryColor,
  fallback,
}: {
  asset: BrandAsset;
  settings: BrandingSettings;
  apiUrl: string;
  primaryColor: string;
  /** What shows instead while nothing is uploaded. */
  fallback: React.ReactNode;
}) {
  const { t } = useTranslation();
  const upload = useUploadBrandAsset(asset);
  const remove = useRemoveBrandAsset(asset);
  const input = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const url = brandingAssetUrl(apiUrl, settings, asset);
  const k = (key: string) => t(`brandingAdmin.assets.${asset}.${key}`);
  const failed = (err: unknown) => setError(err instanceof ApiError && err.message ? err.message : t('brandingAdmin.logoUploadError'));

  const choose = (file: File | undefined) => {
    setError(null);
    if (!file) return;
    if (!(LOGO_MIME_TYPES as readonly string[]).includes(file.type)) return setError(t('brandingAdmin.logoWrongType'));
    if (file.size > LOGO_MAX_BYTES) return setError(t('brandingAdmin.logoTooLarge'));
    upload.mutate(file, { onError: failed });
  };

  const square = asset === 'symbol' || asset === 'appIcon';
  const onBrand = asset === 'logoReverse';
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-border p-4 sm:flex-row sm:items-start">
      <div
        className={`flex shrink-0 items-center justify-center overflow-hidden border border-dashed ${square ? 'h-24 w-24' : 'h-24 w-full sm:w-48'} ${
          asset === 'appIcon' ? 'rounded-[22%]' : 'rounded-lg'
        } ${onBrand ? 'border-transparent' : 'border-border bg-paper'}`}
        style={onBrand ? { backgroundColor: primaryColor } : undefined}
      >
        {url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={url} alt={k('title')} className={asset === 'appIcon' ? 'h-full w-full object-cover' : square ? 'h-16 w-16 object-contain' : 'max-h-14 max-w-[85%] object-contain'} />
        ) : (
          fallback
        )}
      </div>
      <div className="min-w-0 flex-1 space-y-1.5">
        <h3 className="text-sm font-semibold text-ink">{k('title')}</h3>
        <p className="text-sm text-ink/60">{k('hint')}</p>
        <p className="text-xs text-ink/50">{k('spec')}</p>
        <div className="flex flex-wrap gap-2 pt-1">
          <input
            ref={input}
            type="file"
            accept={LOGO_MIME_TYPES.join(',')}
            className="sr-only"
            aria-label={`${url ? t('brandingAdmin.replace') : t('brandingAdmin.upload')}: ${k('title')}`}
            onChange={(e) => {
              choose(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
          <Button variant="secondary" size="sm" disabled={upload.isPending} onClick={() => input.current?.click()}>
            <ImageUp size={14} className="mr-1.5" />
            {upload.isPending ? t('common.loading') : url ? t('brandingAdmin.replace') : t('brandingAdmin.upload')}
          </Button>
          {url && (
            <Button variant="ghost" size="sm" disabled={remove.isPending} aria-label={`${t('brandingAdmin.remove')}: ${k('title')}`} onClick={() => remove.mutate(undefined, { onError: failed })}>
              <Trash2 size={14} className="mr-1.5" />
              {t('brandingAdmin.remove')}
            </Button>
          )}
        </div>
        {error && (
          <p role="alert" className="text-sm text-danger">
            {error}
          </p>
        )}
      </div>
    </div>
  );
}
