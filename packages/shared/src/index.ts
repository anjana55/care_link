// Deliberately types-only. The i18n engine (create-i18n.tsx) is JSX and
// meant for frontends - import it from '@care-platform/shared/i18n'
// instead, so a backend consumer (apps/api) never needs a jsx compiler
// setting just to read these type definitions.
export * from './types/public-search';
