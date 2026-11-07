import type { NextConfig } from 'next';

const nextConfig: NextConfig = {
  // 엔진 패키지는 빌드하지 않고 TypeScript 원본을 그대로 내보낸다.
  transpilePackages: ['@cashleak/engine'],
  // 메일 서버 접속(IMAP)에 쓰는 패키지는 묶지 않고 서버에서 그대로 불러온다.
  serverExternalPackages: ['imapflow'],
};

export default nextConfig;
