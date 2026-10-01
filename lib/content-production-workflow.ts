export const PRODUCTION_WORKFLOW_SCHEMA_VERSION = 1 as const;

export const PRODUCTION_WORKFLOW_STEPS = ["voice", "visuals", "editSpec", "roughCut"] as const;
export type ProductionWorkflowStep = (typeof PRODUCTION_WORKFLOW_STEPS)[number];

export const PRODUCTION_ASSET_ACCEPT: Record<ProductionWorkflowStep, string> = {
  voice: ".mp3,.wav,.m4a,.aac,audio/mpeg,audio/wav,audio/mp4,audio/aac",
  visuals: ".jpg,.jpeg,.png,.webp,.gif,image/jpeg,image/png,image/webp,image/gif",
  editSpec: ".txt,.md,.srt,.vtt,.json,.pdf,text/plain,text/markdown,text/vtt,application/json,application/pdf",
  roughCut: ".mp4,.mov,.m4v,.webm,.mkv,video/mp4,video/quicktime,video/webm",
};

const MIME_BY_EXTENSION: Record<ProductionWorkflowStep, Record<string, string>> = {
  voice: { mp3: "audio/mpeg", wav: "audio/wav", m4a: "audio/mp4", aac: "audio/aac" },
  visuals: { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", gif: "image/gif" },
  editSpec: { txt: "text/plain", md: "text/markdown", srt: "application/x-subrip", vtt: "text/vtt", json: "application/json", pdf: "application/pdf" },
  roughCut: { mp4: "video/mp4", mov: "video/quicktime", m4v: "video/x-m4v", webm: "video/webm", mkv: "video/x-matroska" },
};

export function productionAssetMimeType(kind: ProductionWorkflowStep, file: { name: string; type: string }) {
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  const inferred = MIME_BY_EXTENSION[kind][extension] ?? "";
  return inferred && (!file.type || file.type === inferred || (kind === "voice" && file.type === "audio/x-wav")) ? (file.type || inferred) : inferred;
}

export interface ProductionAsset {
  kind: ProductionWorkflowStep;
  path: string;
  name: string;
  size: number;
  type: string;
  uploadedAt: string;
  uploadedBy: string;
}

export type ProductionAssets = Record<ProductionWorkflowStep, ProductionAsset[]>;

export interface ProductionWorkflowReview {
  step: ProductionWorkflowStep;
  signature: string;
  approved: boolean;
  actorId: string;
  at: string;
  note: string;
}

export interface ProductionWorkflow {
  schemaVersion: typeof PRODUCTION_WORKFLOW_SCHEMA_VERSION;
  reviews: ProductionWorkflowReview[];
}

export interface ProductionWorkflowStepState {
  key: ProductionWorkflowStep;
  label: string;
  artifactUrls: string[];
  assets: ProductionAsset[];
  signature: string;
  approved: boolean;
  canApprove: boolean;
  blocker: string;
  lastReview: ProductionWorkflowReview | null;
}

const assetPath = /^production\/[0-9a-f-]{36}\/[0-9a-f-]{36}\/(voice|visuals|editSpec|roughCut)\/[0-9]{13}-[0-9a-f-]{36}\.[a-z0-9]+$/;

export function emptyProductionAssets(): ProductionAssets {
  return { voice: [], visuals: [], editSpec: [], roughCut: [] };
}

export function productionAssetsOf(value: unknown): ProductionAssets {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const result = emptyProductionAssets();
  for (const kind of PRODUCTION_WORKFLOW_STEPS) {
    const entries = Array.isArray(raw[kind]) ? raw[kind] : [];
    result[kind] = entries.filter((item): item is ProductionAsset => {
      if (!item || typeof item !== "object" || Array.isArray(item)) return false;
      const asset = item as Record<string, unknown>;
      const match = typeof asset.path === "string" ? asset.path.match(assetPath) : null;
      return match?.[1] === kind
        && asset.kind === kind
        && typeof asset.name === "string" && Boolean(asset.name.trim())
        && Number.isSafeInteger(asset.size) && Number(asset.size) > 0
        && typeof asset.type === "string"
        && typeof asset.uploadedAt === "string"
        && typeof asset.uploadedBy === "string";
    }).slice(0, kind === "visuals" ? 100 : 1);
  }
  return result;
}

export interface ProductionWorkflowState {
  steps: ProductionWorkflowStepState[];
  ready: boolean;
  nextAction: string;
  blocker: string;
}

export function productionWorkflowOf(value: unknown): ProductionWorkflow {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const reviews = Array.isArray(raw.reviews) ? raw.reviews.filter((item): item is ProductionWorkflowReview => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const review = item as Record<string, unknown>;
    return PRODUCTION_WORKFLOW_STEPS.includes(review.step as ProductionWorkflowStep)
      && typeof review.signature === "string"
      && typeof review.approved === "boolean"
      && typeof review.actorId === "string"
      && typeof review.at === "string"
      && typeof review.note === "string";
  }) : [];
  return { schemaVersion: PRODUCTION_WORKFLOW_SCHEMA_VERSION, reviews };
}

export function productionStepLabel(step: ProductionWorkflowStep) {
  return ({
    voice: "보이스 MP3",
    visuals: "이미지·캐릭터",
    editSpec: "자막·편집 사양",
    roughCut: "초벌 렌더",
  } as const)[step];
}
