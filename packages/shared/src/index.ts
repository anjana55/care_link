// Deliberately types-only. The i18n engine (create-i18n.tsx) is JSX and
// meant for frontends - import it from '@care-platform/shared/i18n'
// instead, so a backend consumer (apps/api) never needs a jsx compiler
// setting just to read these type definitions.
//
// This file is compiled to CommonJS in dist/ (tsconfig.build.json) and
// package.json's `main`/`exports` point there. That is load-bearing, not
// incidental: apps/api runs as plain `node dist/src/main.js` with no
// transpiler or --experimental-* flag, so anything Node reaches at runtime
// has to be real JavaScript. When this package had no build step, Node was
// loading the raw .ts through its ESM resolver, which will not guess an
// extension - a bare `export * from './types/locale'` crashed the whole API
// at boot with ERR_MODULE_NOT_FOUND, in a restart loop.
//
// So the rule is: anything reachable from here must compile to JS with no
// runtime dependencies beyond what is in this package's `dependencies`.
export * from './types/locale';
export * from './types/public-search';
export * from './types/whatsapp';
