import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // Optional isolated local cache keeps build QA from replacing an open preview.
  distDir: process.env.NODE_ENV === "development" ? process.env.NEXT_DEV_DIST_DIR || ".next" : ".next",
  // 카드뉴스 PNG (next/og) reads its Pretendard weights from here at run time.
  outputFileTracingIncludes: {
    "/api/v1/content/youtube/cards/preview": ["./lib/cardnews/fonts/*.woff", "./public/myin-cards/*"],
    "/myin-information/receipt/*": ["./lib/cardnews/fonts/*.woff", "./lib/cardnews/examples/receipt/*.jpg"],
    "/api/v1/content/youtube/projects/[id]/cards": ["./lib/cardnews/fonts/*.woff", "./public/myin-card-cast/*.png", "./public/myin-2d/*.png", "./public/myin-cards/*"],
    // 롱폼 애니메이션 썸네일: the title is Pretendard 900 (the 썸네일 스타일).
    "/api/v1/content/youtube/projects/[id]/thumbs": ["./lib/cardnews/fonts/Pretendard-900.otf"],
    "/api/v1/content/image-creatives/*/preview": ["./lib/cardnews/fonts/*.woff", "./lib/cardnews/fonts/Pretendard-900.otf", "./lib/image-creative/fonts/*.woff"],
    "/api/v1/content/image-creatives/*/prompt-edit": ["./lib/cardnews/fonts/*.woff", "./lib/cardnews/fonts/Pretendard-900.otf", "./lib/image-creative/fonts/*.woff"],
    "/api/v1/content/image-creatives/*/export": ["./lib/cardnews/fonts/*.woff", "./lib/cardnews/fonts/Pretendard-900.otf", "./lib/image-creative/fonts/*.woff"],
  },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
