import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  reactStrictMode: true,
  // le moteur est un package TypeScript pur du monorepo
  transpilePackages: ['@conso-ci/tariff-engine'],
};

export default nextConfig;