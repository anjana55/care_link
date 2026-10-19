'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Check, ImageUp, RotateCcw, Trash2, TriangleAlert } from 'lucide-react';
import {
  DEFAULT_ACCENT_COLOR,
  DEFAULT_PRIMARY_COLOR,
  LOCALES,
  LOGO_MAX_BYTES,
  LOGO_MIME_TYPES,
  MIN_BRAND_CONTRAST,
  brandingLogoUrl,
  contrastRatio,
  derivePalette,
  initialsOf,
  isHexColor,
  makeAccessible,
  type Locale,
} from '@care-platform/shared';
import { useAuth } from '@/lib/api/auth-context';
import { useTranslation } from '@/lib/i18n/provider';
import { API_URL, ApiError } from '@/lib/api/client';
import {
  useBrandingSettings,
  useRemoveLogo,
  useUpdateBrandingSettings,
  useUploadLogo,
  type BrandingSettings,
} from '@/lib/hooks/use-branding-settings';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input, Label, Select } from '@/components/ui/input';
import { cn } from '@/lib/utils';

type Draft = {
  companyName: string;
  shortName: string;
  tagline: string;
  primaryColor: string;
  accentColor: string;
  defaultLocale: Locale;
  enabledLocales: Locale[];
};

function toDraft(s: BrandingSettings): Draft {
  return {
    companyName: s.companyName,
    shortName: s.shortName,
    tagline: s.tagline ?? '',
    primaryColor: s.primaryColor,
    accentColor: s.accentColor,
    defaultLocale: s.defaultLocale,
    enabledLocales: s.enabledLocales,
  };
}

/** Each language named in itself, as a speaker would look for it. */
const LANGUAGE_NAMES: Record<Locale, string> = { en: 'English', si: 'සිංහල', ta: 'தமிழ்' };

const errorText = (err: unknown, fallback: string) => (err instanceof ApiError && err.message ? err.message : fallback);

/**
 * Settings > Branding (admin): the white-label identity - company name, logo,
 * colour theme and the languages offered. Both apps, every email and every
 * WhatsApp notice read it, so a saved change repaints this page at once and
 * reaches everyone else on their next page load.
 *
 * Colours are checked here with the same rule the API enforces (WCAG AA with
 * white text, since buttons put white text on both), so an operator cannot
 * save a theme that makes the product unreadable.
 */
export default function BrandingSettingsPage() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const router = useRouter();
  const { data: settings, isLoading } = useBrandingSettings();
  const save = useUpdateBrandingSettings();
  const upload = useUploadLogo();
  const removeLogo = useRemoveLogo();
  const [draft, setDraft] = useState<Draft | null>(null);
  const [saved, setSaved] = useState(false);
  const [logoError, setLogoError] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (authLoading) return;
    if (user && user.role !== 'ADMIN') router.replace('/dashboard');
  }, [authLoading, user, router]);

  // Seeded once: a logo upload refreshes `settings` too, and must not wipe unsaved edits.
  useEffect(() => {
    if (settings && !draft) setDraft(toDraft(settings));
  }, [settings, draft]);

  if (authLoading || !user || user.role !== 'ADMIN' || isLoading || !draft || !settings) {
    return <div className="flex min-h-[40vh] items-center justify-center text-sm text-ink/50">{t('common.loading')}</div>;
  }

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setSaved(false);
    setDraft({ ...draft, [key]: value });
  };
  const dirty = JSON.stringify(draft) !== JSON.stringify(toDraft(settings));
  const colorsOk = [draft.primaryColor, draft.accentColor].every((c) => isHexColor(c) && contrastRatio(c, '#FFFFFF') >= MIN_BRAND_CONTRAST);
  const valid = draft.companyName.trim().length > 0 && colorsOk && draft.enabledLocales.length > 0;

  const submit = () => {
    save.mutate(
      { ...draft, companyName: draft.companyName.trim(), shortName: draft.shortName.trim(), tagline: draft.tagline.trim() },
      {
        onSuccess: (data) => {
          setDraft(toDraft(data));
          setSaved(true);
          setTimeout(() => setSaved(false), 3000);
        },
      },
    );
  };

  const toggleLocale = (code: Locale, on: boolean) => {
    const next = LOCALES.filter((l) => (l === code ? on : draft.enabledLocales.includes(l)));
    if (!next.length) return; // at least one language stays on
    setSaved(false);
    setDraft({ ...draft, enabledLocales: next, defaultLocale: next.includes(draft.defaultLocale) ? draft.defaultLocale : next[0] });
  };

  const onLogoChosen = (file: File | undefined) => {
    setLogoError(null);
    if (!file) return;
    if (!(LOGO_MIME_TYPES as readonly string[]).includes(file.type)) return setLogoError(t('brandingAdmin.logoWrongType'));
    if (file.size > LOGO_MAX_BYTES) return setLogoError(t('brandingAdmin.logoTooLarge'));
    upload.mutate(file, { onError: (err) => setLogoError(errorText(err, t('brandingAdmin.logoUploadError'))) });
  };

  const logoUrl = brandingLogoUrl(API_URL, settings);
  const shortNamePreview = draft.shortName.trim() || initialsOf(draft.companyName);

  return (
    <div className="grid max-w-5xl gap-4 lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start">
      <div className="space-y-4">
        <Card>
          <CardHeader>
            <CardTitle>{t('brandingAdmin.companyTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_8rem]">
            <p className="text-sm text-ink/60 sm:col-span-2">{t('brandingAdmin.companyHint')}</p>
            <div>
              <Label htmlFor="companyName" required>{t('brandingAdmin.companyName')}</Label>
              <Input id="companyName" maxLength={120} value={draft.companyName} onChange={(e) => set('companyName', e.target.value)} />
            </div>
            <div>
              <Label htmlFor="shortName">{t('brandingAdmin.shortName')}</Label>
              <Input
                id="shortName"
                maxLength={4}
                value={draft.shortName}
                onChange={(e) => set('shortName', e.target.value.replace(/\s/g, '').toUpperCase())}
                placeholder={initialsOf(draft.companyName)}
              />
            </div>
            <p className="-mt-1 text-xs text-ink/50 sm:col-span-2">{t('brandingAdmin.shortNameHint')}</p>
            <div className="sm:col-span-2">
              <Label htmlFor="tagline">{t('brandingAdmin.tagline')}</Label>
              <Input id="tagline" maxLength={160} value={draft.tagline} onChange={(e) => set('tagline', e.target.value)} placeholder={t('brandingAdmin.taglinePlaceholder')} />
              <p className="mt-1 text-xs text-ink/50">{t('brandingAdmin.taglineHint')}</p>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('brandingAdmin.logoTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-ink/60">{t('brandingAdmin.logoHint')}</p>
            <div className="flex flex-wrap items-center gap-4">
              <div className="flex h-20 min-w-[8rem] items-center justify-center rounded-lg border border-dashed border-border bg-paper px-4">
                {logoUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={logoUrl} alt={t('brandingAdmin.logoAlt')} className="max-h-14 max-w-[12rem] object-contain" />
                ) : (
                  <span
                    className="flex h-11 min-w-11 items-center justify-center rounded px-1 text-base font-bold text-white"
                    style={{ backgroundColor: isHexColor(draft.primaryColor) ? draft.primaryColor : DEFAULT_PRIMARY_COLOR }}
                  >
                    {shortNamePreview}
                  </span>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                <input
                  ref={fileInput}
                  type="file"
                  accept={LOGO_MIME_TYPES.join(',')}
                  className="sr-only"
                  aria-label={t('brandingAdmin.uploadLogo')}
                  onChange={(e) => {
                    onLogoChosen(e.target.files?.[0]);
                    e.target.value = '';
                  }}
                />
                <Button variant="secondary" size="sm" disabled={upload.isPending} onClick={() => fileInput.current?.click()}>
                  <ImageUp size={14} className="mr-1.5" />
                  {upload.isPending ? t('common.loading') : logoUrl ? t('brandingAdmin.replaceLogo') : t('brandingAdmin.uploadLogo')}
                </Button>
                {logoUrl && (
                  <Button
                    variant="ghost"
                    size="sm"
                    disabled={removeLogo.isPending}
                    onClick={() => removeLogo.mutate(undefined, { onError: (err) => setLogoError(errorText(err, t('brandingAdmin.logoUploadError'))) })}
                  >
                    <Trash2 size={14} className="mr-1.5" />
                    {t('brandingAdmin.removeLogo')}
                  </Button>
                )}
              </div>
            </div>
            <p className="text-xs text-ink/50">{t('brandingAdmin.logoFormats')}</p>
            {logoError && (
              <p role="alert" className="text-sm text-danger">
                {logoError}
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-wrap items-center justify-between gap-2">
            <CardTitle>{t('brandingAdmin.colorsTitle')}</CardTitle>
            {(draft.primaryColor !== DEFAULT_PRIMARY_COLOR || draft.accentColor !== DEFAULT_ACCENT_COLOR) && (
              <button
                type="button"
                className="inline-flex items-center gap-1 text-xs font-medium text-ink/60 hover:text-brand"
                onClick={() => {
                  setSaved(false);
                  setDraft({ ...draft, primaryColor: DEFAULT_PRIMARY_COLOR, accentColor: DEFAULT_ACCENT_COLOR });
                }}
              >
                <RotateCcw size={12} />
                {t('brandingAdmin.resetColors')}
              </button>
            )}
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm text-ink/60">{t('brandingAdmin.colorsHint')}</p>
            <div className="grid gap-4 sm:grid-cols-2">
              <ColorField id="primaryColor" label={t('brandingAdmin.primaryColor')} hint={t('brandingAdmin.primaryHint')} value={draft.primaryColor} onChange={(v) => set('primaryColor', v)} />
              <ColorField id="accentColor" label={t('brandingAdmin.accentColor')} hint={t('brandingAdmin.accentHint')} value={draft.accentColor} onChange={(v) => set('accentColor', v)} />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>{t('brandingAdmin.languagesTitle')}</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-ink/60">{t('brandingAdmin.languagesHint')}</p>
            <fieldset className="flex flex-wrap gap-2">
              <legend className="sr-only">{t('brandingAdmin.languagesOffered')}</legend>
              {LOCALES.map((code) => {
                const on = draft.enabledLocales.includes(code);
                const last = on && draft.enabledLocales.length === 1;
                return (
                  <label
                    key={code}
                    className={cn(
                      'flex cursor-pointer items-center gap-2 rounded border px-3 py-2 text-sm transition-colors',
                      on ? 'border-brand bg-brand-light/40 text-ink' : 'border-border bg-white text-ink/60',
                      last && 'cursor-not-allowed',
                    )}
                    title={last ? t('brandingAdmin.lastLanguage') : undefined}
                  >
                    <input type="checkbox" className="h-4 w-4 accent-brand" checked={on} disabled={last} onChange={(e) => toggleLocale(code, e.target.checked)} />
                    <span lang={code}>{LANGUAGE_NAMES[code]}</span>
                  </label>
                );
              })}
            </fieldset>
            <div className="max-w-xs">
              <Label htmlFor="defaultLocale">{t('brandingAdmin.defaultLanguage')}</Label>
              <Select id="defaultLocale" value={draft.defaultLocale} onChange={(e) => set('defaultLocale', e.target.value as Locale)}>
                {draft.enabledLocales.map((code) => (
                  <option key={code} value={code}>
                    {LANGUAGE_NAMES[code]}
                  </option>
                ))}
              </Select>
              <p className="mt-1 text-xs text-ink/50">{t('brandingAdmin.defaultLanguageHint')}</p>
            </div>
            <p className="text-xs text-ink/50">{t('brandingAdmin.regionalNote')}</p>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button disabled={!dirty || !valid || save.isPending} onClick={submit}>
            {save.isPending ? t('common.loading') : t('common.save')}
          </Button>
          {dirty && (
            <Button variant="ghost" onClick={() => setDraft(toDraft(settings))}>
              {t('common.cancel')}
            </Button>
          )}
          {saved && <span className="text-sm text-brand-dark">{t('brandingAdmin.saved')}</span>}
          {save.isError && (
            <p role="alert" className="text-sm text-danger">
              {errorText(save.error, t('brandingAdmin.saveError'))}
            </p>
          )}
        </div>
      </div>

      <BrandPreview draft={draft} shortName={shortNamePreview} logoUrl={logoUrl} />
    </div>
  );
}

/** A colour picker, its hex value, and whether white text on it is readable. */
function ColorField({ id, label, hint, value, onChange }: { id: string; label: string; hint: string; value: string; onChange: (v: string) => void }) {
  const { t } = useTranslation();
  const [text, setText] = useState(value);
  useEffect(() => setText(value), [value]);
  const valid = isHexColor(value);
  const ratio = valid ? contrastRatio(value, '#FFFFFF') : 0;
  const passes = ratio >= MIN_BRAND_CONTRAST;

  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <div className="flex items-center gap-2">
        <input
          type="color"
          aria-label={label}
          value={valid ? value.toLowerCase() : '#000000'}
          onChange={(e) => onChange(e.target.value.toUpperCase())}
          className="h-10 w-12 shrink-0 cursor-pointer rounded border border-border bg-white p-1"
        />
        <Input
          id={id}
          value={text}
          maxLength={7}
          spellCheck={false}
          className="font-mono uppercase"
          onChange={(e) => {
            const raw = e.target.value.trim();
            const next = raw.startsWith('#') ? raw : `#${raw}`;
            setText(next.toUpperCase());
            if (isHexColor(next)) onChange(next.toUpperCase());
          }}
          aria-invalid={!isHexColor(text)}
        />
      </div>
      <p className="mt-1 text-xs text-ink/50">{hint}</p>
      {valid && (
        <div className={cn('mt-2 flex flex-wrap items-center gap-2 text-xs', passes ? 'text-brand-dark' : 'text-danger')} aria-live="polite">
          {passes ? <Check size={13} aria-hidden /> : <TriangleAlert size={13} aria-hidden />}
          <span>{t(passes ? 'brandingAdmin.contrastOk' : 'brandingAdmin.contrastLow', { ratio: ratio.toFixed(1), min: MIN_BRAND_CONTRAST })}</span>
          {!passes && (
            <button type="button" className="font-semibold underline underline-offset-2 hover:text-ink" onClick={() => onChange(makeAccessible(value))}>
              {t('brandingAdmin.makeAccessible')}
            </button>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * A miniature of the public site and staff app in the draft colours - drawn
 * with inline styles, so it shows the unsaved theme without repainting the
 * page around it.
 */
function BrandPreview({ draft, shortName, logoUrl }: { draft: Draft; shortName: string; logoUrl: string | null }) {
  const { t } = useTranslation();
  const p = derivePalette(
    isHexColor(draft.primaryColor) ? draft.primaryColor : DEFAULT_PRIMARY_COLOR,
    isHexColor(draft.accentColor) ? draft.accentColor : DEFAULT_ACCENT_COLOR,
  );
  const name = draft.companyName.trim() || '—';

  return (
    <aside className="lg:sticky lg:top-20" aria-label={t('brandingAdmin.previewTitle')}>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink/50">{t('brandingAdmin.previewTitle')}</p>
      <div className="overflow-hidden rounded-lg border shadow-sm" style={{ borderColor: p.border, backgroundColor: p.paper }}>
        <div className="flex items-center gap-2 border-b bg-white px-3 py-2.5" style={{ borderColor: p.border }}>
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={logoUrl} alt="" className="h-7 w-auto max-w-[7rem] object-contain" />
          ) : (
            <span className="flex h-7 min-w-7 items-center justify-center rounded px-1 text-xs font-bold text-white" style={{ backgroundColor: p.brand }}>
              {shortName}
            </span>
          )}
          <span className="truncate text-sm font-semibold text-ink">{name}</span>
        </div>
        <div className="space-y-3 p-4">
          <div>
            <p className="text-base font-semibold leading-snug text-ink">{draft.tagline.trim() || t('brandingAdmin.previewHeadline')}</p>
            <p className="mt-1 text-xs text-ink/60">{t('brandingAdmin.previewBody', { brand: name })}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded px-3 py-1.5 text-xs font-semibold text-white" style={{ backgroundColor: p.brand }}>
              {t('brandingAdmin.previewPrimary')}
            </span>
            <span className="rounded border bg-white px-3 py-1.5 text-xs font-semibold" style={{ borderColor: p.border, color: p.brandDark }}>
              {t('brandingAdmin.previewSecondary')}
            </span>
          </div>
          <div className="rounded-lg border bg-white p-3" style={{ borderColor: p.border }}>
            <div className="flex items-center justify-between gap-2">
              <span className="text-sm font-medium text-ink">{t('brandingAdmin.previewCard')}</span>
              <span className="rounded px-2 py-0.5 text-[11px] font-semibold text-white" style={{ backgroundColor: p.accent }}>
                {t('brandingAdmin.previewBadge')}
              </span>
            </div>
            <div className="mt-2 rounded px-2 py-1.5 text-xs" style={{ backgroundColor: p.brandLight, color: p.brandDark }}>
              {t('brandingAdmin.previewTint')}
            </div>
            <p className="mt-2 text-xs font-medium underline underline-offset-2" style={{ color: p.accentDark }}>
              {t('brandingAdmin.previewLink')}
            </p>
          </div>
        </div>
      </div>
      <p className="mt-2 text-xs text-ink/50">{t('brandingAdmin.previewNote')}</p>
    </aside>
  );
}
