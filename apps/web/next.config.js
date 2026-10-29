/** @type {import('next').NextConfig} */
const basePath = '/staff';

const nextConfig = {
  basePath,
  // Client code needs it for files in public/ (the map's worker), which
  // basePath also prefixes but Next doesn't expose to the browser itself.
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  reactStrictMode: true,
  // assetPrefix: '/staff',   // usually not needed when using basePath
  // See apps/public-web/next.config.js for why standalone output is used.
  output: 'standalone',
};

module.exports = nextConfig;
