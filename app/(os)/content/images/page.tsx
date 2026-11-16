import type { Metadata } from "next";
import { ImageCreativeWorkspace } from "@/components/image-creative-workspace";

export const metadata: Metadata = { title: "이미지 광고 | 브랜디 OS" };
export default function ImageCreativePage() {
  if (process.env.NODE_ENV === "development" && process.env.IMAGE_AD_LIVE_CANON === "1") return <ImageCreativeWorkspace localDirectionPlanner previewProducts={[]} />;
  const catalog = process.env.NODE_ENV === "development" && process.env.IMAGE_AD_LOCAL_CATALOG;
  if (catalog) return <ImageCreativeWorkspace previewProducts={JSON.parse(catalog)} />;
  return <ImageCreativeWorkspace />;
}
