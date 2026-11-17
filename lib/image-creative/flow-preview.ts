import type { ImageAsset } from "./model";
import type { ReferenceLayout } from "./reference-layout";
import type { ReferenceEntry } from "./reference-canon";

// Development-only fixtures. This is a workflow review, not an AI generation result.
export interface ImageFlowPreview {
  renderProductIds?: string[];
  promptEditExamples?: Array<{prompt:string;sourceSha256:string;model:string;image:ImageAsset & {url:string}}>;
  warehouse?: { entries: ReferenceEntry[]; approvedIds: string[]; checkedAt: string };
  references: Array<{
    id: string;
    name: string;
    imageUrl: string;
    layout: ReferenceLayout;
    assets: Array<ImageAsset & { url: string }>;
    photoPath?: string;
    detailAssetPath?: string;
  }>;
  cta: string;
  body: string;
}
