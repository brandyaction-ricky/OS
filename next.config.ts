import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // 카드뉴스 PNG (next/og) reads its Pretendard weights from here at run time.
  outputFileTracingIncludes: {
    "/api/v1/content/youtube/projects/[id]/cards": ["./lib/cardnews/fonts/*.woff"],
    // 롱폼 애니메이션 썸네일: the title is Pretendard 900 (the 썸네일 스타일).
    "/api/v1/content/youtube/projects/[id]/thumbs": ["./lib/cardnews/fonts/Pretendard-900.otf"],
    "/api/v1/content/image-creatives/*/preview": ["./lib/cardnews/fonts/*.woff", "./lib/cardnews/fonts/Pretendard-900.otf", "./lib/image-creative/fonts/*.woff"],
    "/api/v1/content/image-creatives/*/export": ["./lib/cardnews/fonts/*.woff", "./lib/cardnews/fonts/Pretendard-900.otf", "./lib/image-creative/fonts/*.woff"],
  },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
