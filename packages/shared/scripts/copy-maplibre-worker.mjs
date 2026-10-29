// Copies MapLibre's web worker into the calling app's public/ folder, as
// public/maplibre/<version>/maplibre-gl-worker.mjs. Run from an app's folder;
// both web apps call it before `next dev` and `next build`.
//
// Why: MapLibre 6 finds its worker relative to its own file
// (new URL(file, import.meta.url)). Next.js renames and moves that file into
// _next/static/chunks/, where the worker isn't, so it 404s - and the worker is
// what parses map tiles and GeoJSON, so the basemap and the search-radius
// circle never draw. The map component points MapLibre at this copy instead
// (setWorkerUrl). The version is in the path, so a browser holding an old
// worker in its cache can never pair it with a newer MapLibre.
import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const app = process.cwd();
const require = createRequire(join(app, 'package.json'));
const manifest = require.resolve('maplibre-gl/package.json');
const { version } = require(manifest);

const source = join(dirname(manifest), 'dist', 'maplibre-gl-worker.mjs');
const target = join(app, 'public', 'maplibre');

// Only the installed version: earlier ones are left over from before an upgrade.
if (existsSync(target)) {
  for (const entry of readdirSync(target)) {
    if (entry !== version) rmSync(join(target, entry), { recursive: true, force: true });
  }
}
mkdirSync(join(target, version), { recursive: true });
copyFileSync(source, join(target, version, 'maplibre-gl-worker.mjs'));
console.log(`MapLibre ${version} worker -> public/maplibre/${version}/maplibre-gl-worker.mjs`);
