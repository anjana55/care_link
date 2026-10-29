// Expo SDK 52+ sets Metro up for monorepos by itself: it watches the repo root
// and resolves packages from both node_modules folders, so
// @care-platform/shared needs nothing here. Don't add watchFolders or
// nodeModulesPaths overrides - Expo's docs say they now get in the way.
const { getDefaultConfig } = require('expo/metro-config');

module.exports = getDefaultConfig(__dirname);
