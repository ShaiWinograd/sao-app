import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  devIndicators: false,
  experimental: {
    devtoolSegmentExplorer: false,
  },
  transpilePackages: ['@workforce/shared'],
  serverExternalPackages: ['@prisma/client'],
};

export default nextConfig;
