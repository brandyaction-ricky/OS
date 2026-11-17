import { readFileSync } from "node:fs";
import { isDemoMode } from "@/lib/config";
import type { ImageFlowPreview } from "@/lib/image-creative/flow-preview";
import type { ImagePreviewProduct } from "@/components/guided-image-creative";
import type { Metadata } from "next";
import { ImageCreativeWorkspace } from "@/components/image-creative-workspace";

export const metadata: Metadata = { title: "이미지 광고 | 브랜디 OS" };
export default function ImageCreativePage() {
  const reviewFile = process.env.NODE_ENV === "development" && isDemoMode() && process.env.IMAGE_AD_FLOW_PREVIEW_FILE;
  if (reviewFile) {
    const review = JSON.parse(readFileSync(reviewFile, "utf8")) as {products: ImagePreviewProduct[]; flow: ImageFlowPreview};
    return <ImageCreativeWorkspace previewProducts={review.products} flowPreview={review.flow} />;
  }
  if (process.env.NODE_ENV === "development" && process.env.IMAGE_AD_LIVE_CANON === "1") return <ImageCreativeWorkspace localDirectionPlanner previewProducts={[]} />;
  const catalog = process.env.NODE_ENV === "development" && process.env.IMAGE_AD_LOCAL_CATALOG;
  if (catalog) return <ImageCreativeWorkspace previewProducts={JSON.parse(catalog)} />;
  return <ImageCreativeWorkspace />;
}
