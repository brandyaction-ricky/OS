import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // 카드뉴스 PNG (next/og) reads its Pretendard weights from here at run time.
  outputFileTracingIncludes: { "/api/v1/content/youtube/projects/[id]/cards": ["./lib/cardnews/fonts/*.woff"] },
  experimental: {
    optimizePackageImports: ["lucide-react"],
  },
};

export default nextConfig;
