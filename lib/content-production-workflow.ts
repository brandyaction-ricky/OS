export const PRODUCTION_WORKFLOW_SCHEMA_VERSION = 1 as const;

export const PRODUCTION_WORKFLOW_STEPS = ["voice", "visuals", "editSpec", "roughCut"] as const;
export type ProductionWorkflowStep = (typeof PRODUCTION_WORKFLOW_STEPS)[number];

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
  signature: string;
  approved: boolean;
  canApprove: boolean;
  blocker: string;
  lastReview: ProductionWorkflowReview | null;
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
