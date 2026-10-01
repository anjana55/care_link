/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Standalone output traces only the modules actually imported (see the
  // Dockerfile), instead of shipping the whole node_modules tree - this
  // matters here more than usual, since transpilePackages below means
  // @care-platform/shared's TS source has to be traced correctly too.
  output: 'standalone',
  // The shared package ships TS source, not a pre-built dist - Next needs
  // to transpile it itself rather than treating it as opaque node_modules.
  transpilePackages: ['@care-platform/shared'],
};

module.exports = nextConfig;
