#!/usr/bin/env node
/**
 * Fetches the brand's artwork from the deployment's Settings > Branding and
 * turns it into what a phone needs baked into the app: the home-screen icon,
 * Android's adaptive icon and the splash screen. Everything else (logos,
 * colours, the name inside the app) is read live from the API, so only these
 * need a new build when they change.
 *
 *   npm run brand:assets              (the brand in BRAND, default carelink)
 *   BRAND=carelink npm run brand:assets -- --api https://find.caregivers.lk/api
 *
 * Writes assets/brand/<brand>/: icon.png (1024, no transparency - the App
 * Store refuses it), adaptive-icon.png (1024, transparent, the mark inside
 * Android's safe zone), splash-icon.png (512, transparent) and brand.json
 * (the colours behind them). app.config.ts uses these when they exist and
 * Expo's defaults when they don't.
 *
 * EAS Build runs it too (the eas-build-post-install script) with --optional:
 * if the API can't be reached, the build carries on with the files already in
 * the repo, or the defaults.
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const optional = process.argv.includes('--optional');
const apiArg = process.argv.indexOf('--api');

function fail(message) {
  if (optional) {
    console.warn(`brand-assets: ${message} - keeping the current icons.`);
    process.exit(0);
  }
  console.error(`brand-assets: ${message}`);
  process.exit(1);
}

let sharp;
try {
  sharp = require('sharp');
} catch {
  fail('sharp is not installed (run npm install at the repo root)');
}

// The brand's API from app.config.ts, unless given.
const { getConfig } = require('@expo/config');
const { exp } = getConfig(root, { skipSDKVersionRequirement: true });
const brand = exp.extra?.brand ?? 'carelink';
const api = (apiArg > -1 ? process.argv[apiArg + 1] : exp.extra?.apiUrl)?.replace(/\/+$/, '');
if (!api) fail('no API address');

async function get(path) {
  const res = await fetch(`${api}${path}`, { signal: AbortSignal.timeout(20000) });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`${path}: HTTP ${res.status}`);
  return res;
}

let branding;
try {
  branding = await (await get('/branding')).json();
} catch (err) {
  fail(`could not read ${api}/branding (${err.message})`);
}
const assets = branding.assets ?? { logo: branding.logoVersion ?? null };
const png = async (path, size) => Buffer.from(await (await get(`/branding/${path}?size=${size}`)).arrayBuffer());

/** `art` centred on a square `size` canvas, scaled to `fraction` of it, on `background` (or transparent). */
async function centred(art, size, fraction, background) {
  const inner = Math.round(size * fraction);
  const scaled = await sharp(art).resize({ width: inner, height: inner, fit: 'inside' }).png().toBuffer();
  return sharp({ create: { width: size, height: size, channels: 4, background: background ?? { r: 0, g: 0, b: 0, alpha: 0 } } })
    .composite([{ input: scaled, gravity: 'centre' }])
    .png()
    .toBuffer();
}

const out = join(root, 'assets', 'brand', brand);
await mkdir(out, { recursive: true });
const white = '#FFFFFF';
const mark = assets.symbol ? await png('symbol', 1024) : assets.logo ? await png('logo', 1024) : null;
if (!assets.appIcon && !mark) fail('Settings > Branding has no app icon, symbol or logo yet');

/**
 * The colour to fill an icon's transparent parts with. An icon exported with
 * rounded corners (as for a website) would show white corners inside the
 * phone's own mask, so they are filled with the icon's background - read from
 * the middle of its top edge, just inside any rounding.
 */
async function edgeColour(picture) {
  const { data, info } = await sharp(picture).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const at = (x, y) => data.subarray((y * info.width + x) * 4, (y * info.width + x) * 4 + 4);
  const [r, g, b, a] = at(Math.floor(info.width / 2), Math.floor(info.height * 0.02));
  return a > 200 ? { r, g, b } : white;
}

// The home-screen icon: the app icon as uploaded (full-bleed), else the mark on white.
const uploadedIcon = assets.appIcon ? await sharp(await png('app-icon', 1024)).resize(1024, 1024, { fit: 'cover' }).png().toBuffer() : null;
const icon = uploadedIcon
  ? await sharp(uploadedIcon).flatten({ background: await edgeColour(uploadedIcon) }).png().toBuffer()
  : await sharp(await centred(mark, 1024, 0.66, white)).flatten({ background: white }).png().toBuffer();
await writeFile(join(out, 'icon.png'), icon);

// Android crops the adaptive icon to a circle, squircle or square: the picture
// fills the layer, and anything outside the middle two-thirds may be cut.
const adaptive = assets.appIcon ? icon : await centred(mark, 1024, 0.6, null);
await writeFile(join(out, 'adaptive-icon.png'), adaptive);

// The splash: the mark alone, transparent, on a white screen.
if (mark) await writeFile(join(out, 'splash-icon.png'), await centred(mark, 512, 1, null));

await writeFile(
  join(out, 'brand.json'),
  `${JSON.stringify({ companyName: branding.companyName, primaryColor: branding.primaryColor, adaptiveBackground: white, splashBackground: white, fetchedFrom: api, versions: assets }, null, 2)}\n`,
);
console.log(`brand-assets: wrote ${out} from ${api}`);
