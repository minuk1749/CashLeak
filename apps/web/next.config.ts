import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 엔진 패키지는 빌드하지 않고 TypeScript 원본을 그대로 내보낸다.
  transpilePackages: ['@cashleak/engine'],
};

export default nextConfig;
