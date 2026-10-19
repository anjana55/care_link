import { LOCALES, DEFAULT_LOCALE, type Locale } from './locale';

/**
 * White-label branding: the name, logo, colours and languages an operator
 * configures in Settings > Branding. One definition shared by the API (which
 * validates and stores it) and both frontends (which paint themselves with it),
 * so "what counts as a readable colour" cannot differ between the form that
 * accepts it and the page that renders it.
 */

export const DEFAULT_COMPANY_NAME = 'CareLink';
export const DEFAULT_SHORT_NAME = 'CL';
export const DEFAULT_PRIMARY_COLOR = '#5F6952';
export const DEFAULT_ACCENT_COLOR = '#2F7A84';

/** WCAG AA for normal text. Buttons put white text on both colours, and both are used as text on white. */
export const MIN_BRAND_CONTRAST = 4.5;

export const LOGO_MIME_TYPES = ['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml'] as const;
export const LOGO_MAX_BYTES = 1024 * 1024;

/** What every visitor - signed in or not - is told about the brand. GET /branding. */
export interface PublicBranding {
  companyName: string;
  /** 1-4 characters shown in the badge when there is no logo. */
  shortName: string;
  tagline: string | null;
  primaryColor: string;
  accentColor: string;
  /** Changes whenever the logo does; null when there is no logo. Append as ?v= to bust caches. */
  logoVersion: string | null;
  defaultLocale: Locale;
  /** Always contains defaultLocale; in LOCALES order. */
  enabledLocales: Locale[];
}

export const DEFAULT_BRANDING: PublicBranding = {
  companyName: DEFAULT_COMPANY_NAME,
  shortName: DEFAULT_SHORT_NAME,
  tagline: null,
  primaryColor: DEFAULT_PRIMARY_COLOR,
  accentColor: DEFAULT_ACCENT_COLOR,
  logoVersion: null,
  defaultLocale: DEFAULT_LOCALE,
  enabledLocales: [...LOCALES],
};

/** The logo's address under an API base such as '/api'. */
export function brandingLogoUrl(apiBase: string, branding: Pick<PublicBranding, 'logoVersion'>): string | null {
  if (!branding.logoVersion) return null;
  return `${apiBase.replace(/\/+$/, '')}/branding/logo?v=${encodeURIComponent(branding.logoVersion)}`;
}

/**
 * "Golden Years Care" -> "GY", "CareLink" -> "CL", "Nurse" -> "NU". Used when
 * an operator leaves the short name blank.
 */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length > 1) return words.slice(0, 2).map((w) => [...w][0]).join('').toUpperCase();
  const word = words[0] ?? '';
  const capitals = [...word].filter((c) => c !== c.toLowerCase());
  const letters = capitals.length >= 2 ? capitals.slice(0, 2) : [...word].slice(0, 2);
  return letters.join('').toUpperCase() || DEFAULT_SHORT_NAME;
}

/** Narrows a stored or submitted language set: known locales only, in LOCALES order, default always included. */
export function normalizeLocales(enabled: readonly string[] | null | undefined, defaultLocale: Locale): Locale[] {
  const set = new Set<string>(enabled ?? LOCALES);
  set.add(defaultLocale);
  return LOCALES.filter((l) => set.has(l));
}

// --- colour -------------------------------------------------------------------

type Rgb = [number, number, number];

const HEX = /^#[0-9a-fA-F]{6}$/;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

function toRgb(hex: string): Rgb {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function toHex([r, g, b]: Rgb): string {
  return `#${[r, g, b].map((c) => Math.round(Math.min(255, Math.max(0, c))).toString(16).padStart(2, '0')).join('').toUpperCase()}`;
}

/** Blends `hex` toward `toward` - weight 0 keeps `hex`, 1 gives `toward`. */
function mix(hex: string, toward: string, weight: number): string {
  const a = toRgb(hex);
  const b = toRgb(toward);
  return toHex([0, 1, 2].map((i) => a[i] + (b[i] - a[i]) * weight) as Rgb);
}

function luminance(hex: string): number {
  const [r, g, b] = toRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** WCAG contrast ratio, 1-21. */
export function contrastRatio(a: string, b: string): number {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
}

export function meetsBrandContrast(hex: string): boolean {
  return isHexColor(hex) && contrastRatio(hex, '#FFFFFF') >= MIN_BRAND_CONTRAST;
}

/**
 * The nearest darker shade of `hex` that is readable with white text: the
 * same hue, mixed toward black in small steps until it passes. Returns the
 * colour unchanged when it already does.
 */
export function makeAccessible(hex: string): string {
  if (!isHexColor(hex)) return DEFAULT_PRIMARY_COLOR;
  let out = hex.toUpperCase();
  for (let w = 0.02; !meetsBrandContrast(out) && w <= 1; w += 0.02) out = mix(hex, '#000000', w);
  return out;
}

export interface BrandPalette {
  brand: string;
  brandDark: string;
  brandLight: string;
  accent: string;
  accentDark: string;
  accentLight: string;
  /** Page background, a whisper of the brand colour. */
  paper: string;
  /** Hairlines. */
  border: string;
}

/**
 * The hand-tuned palette the product shipped with (see the tailwind configs).
 * The default colours return it exactly, so an operator who never touches
 * Settings > Branding sees no change at all.
 */
const SHIPPED_PALETTE: BrandPalette = {
  brand: '#5F6952',
  brandDark: '#4F5745',
  brandLight: '#E4E8DE',
  accent: '#2F7A84',
  accentDark: '#2A6B74',
  accentLight: '#DCE8EA',
  paper: '#F6F8F2',
  border: '#DCE0D6',
};

/** Every shade the UI uses, derived from the two colours an operator picks. */
export function derivePalette(primary: string, accent: string): BrandPalette {
  const p = isHexColor(primary) ? primary.toUpperCase() : DEFAULT_PRIMARY_COLOR;
  const a = isHexColor(accent) ? accent.toUpperCase() : DEFAULT_ACCENT_COLOR;
  const brandPart =
    p === DEFAULT_PRIMARY_COLOR
      ? { brand: SHIPPED_PALETTE.brand, brandDark: SHIPPED_PALETTE.brandDark, brandLight: SHIPPED_PALETTE.brandLight, paper: SHIPPED_PALETTE.paper, border: SHIPPED_PALETTE.border }
      : { brand: p, brandDark: mix(p, '#000000', 0.17), brandLight: mix(p, '#FFFFFF', 0.83), paper: mix(p, '#FFFFFF', 0.945), border: mix(p, '#FFFFFF', 0.78) };
  const accentPart =
    a === DEFAULT_ACCENT_COLOR
      ? { accent: SHIPPED_PALETTE.accent, accentDark: SHIPPED_PALETTE.accentDark, accentLight: SHIPPED_PALETTE.accentLight }
      : { accent: a, accentDark: mix(a, '#000000', 0.12), accentLight: mix(a, '#FFFFFF', 0.83) };
  return { ...brandPart, ...accentPart };
}

const CSS_VAR: Record<keyof BrandPalette, string> = {
  brand: '--color-brand',
  brandDark: '--color-brand-dark',
  brandLight: '--color-brand-light',
  accent: '--color-accent',
  accentDark: '--color-accent-dark',
  accentLight: '--color-accent-light',
  paper: '--color-paper',
  border: '--color-border',
};

/**
 * The palette as CSS custom properties holding bare "R G B" channels, the form
 * the tailwind configs read through `rgb(var(--x) / <alpha-value>)` so opacity
 * modifiers such as `border-brand/30` keep working.
 */
export function paletteCssVars(palette: BrandPalette): Record<string, string> {
  const out: Record<string, string> = {};
  for (const key of Object.keys(CSS_VAR) as (keyof BrandPalette)[]) out[CSS_VAR[key]] = toRgb(palette[key]).join(' ');
  return out;
}

/** `:root { --color-brand: 95 105 82; ... }` for a server-rendered <style>. */
export function paletteCss(palette: BrandPalette): string {
  const body = Object.entries(paletteCssVars(palette))
    .map(([k, v]) => `${k}:${v}`)
    .join(';');
  return `:root{${body}}`;
}

/**
 * Anything claimed to be branding -> a usable PublicBranding. The frontends
 * read it from the network on every page load; a missing or malformed field
 * falls back to the default rather than painting an unreadable page.
 */
export function normalizeBranding(raw: unknown): PublicBranding {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof PublicBranding, unknown>>;
  const str = (v: unknown, max: number) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
  const companyName = str(r.companyName, 120) ?? DEFAULT_COMPANY_NAME;
  const defaultLocale = LOCALES.includes(r.defaultLocale as Locale) ? (r.defaultLocale as Locale) : DEFAULT_LOCALE;
  return {
    companyName,
    shortName: str(r.shortName, 4) ?? initialsOf(companyName),
    tagline: str(r.tagline, 160),
    primaryColor: meetsBrandContrast(r.primaryColor as string) ? (r.primaryColor as string).toUpperCase() : DEFAULT_PRIMARY_COLOR,
    accentColor: meetsBrandContrast(r.accentColor as string) ? (r.accentColor as string).toUpperCase() : DEFAULT_ACCENT_COLOR,
    logoVersion: typeof r.logoVersion === 'string' && /^[0-9a-zA-Z_-]{1,40}$/.test(r.logoVersion) ? r.logoVersion : null,
    defaultLocale,
    enabledLocales: normalizeLocales(Array.isArray(r.enabledLocales) ? (r.enabledLocales as string[]) : null, defaultLocale),
  };
}

/** The shipped heart mark, in the brand colour, as a favicon for deployments without a logo. */
export function defaultFaviconDataUrl(primaryColor: string): string {
  const fill = isHexColor(primaryColor) ? primaryColor : DEFAULT_PRIMARY_COLOR;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="7" fill="${fill}"/>` +
    '<path fill="#FFFFFF" d="M16 25.2c-.4 0-.8-.15-1.1-.44-2.2-2.1-7.2-6.6-8.6-9.4-1.2-2.4-.2-5.5 2.3-6.7 2-1 4.5-.6 6.1.9l1.3 1.4 1.3-1.4c1.6-1.5 4.1-1.9 6.1-.9 2.5 1.2 3.5 4.3 2.3 6.7-1.4 2.8-6.4 7.3-8.6 9.4-.3.29-.7.44-1.1.44z"/></svg>';
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
