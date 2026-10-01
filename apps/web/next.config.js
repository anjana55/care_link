/** @type {import('next').NextConfig} */
const nextConfig = {
  basePath: '/staff',
  reactStrictMode: true,
  // assetPrefix: '/staff',   // usually not needed when using basePath
  // See apps/public-web/next.config.js for why standalone output is used.
  output: 'standalone',
};

module.exports = nextConfig;
