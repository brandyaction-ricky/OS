export const WRITING_WORKFLOW_SCHEMA_VERSION = 1 as const;

export const WRITING_WORKFLOW_STEPS = ["package", "materials", "axis", "design"] as const;
export type WritingWorkflowStep = (typeof WRITING_WORKFLOW_STEPS)[number];
export type WritingPreparationStep = Exclude<WritingWorkflowStep, "package">;

export interface WritingWorkflowReview {
  step: WritingWorkflowStep;
  signature: string;
  approved: boolean;
  actorId: string;
  at: string;
  note: string;
}

export interface WritingWorkflow {
  schemaVersion: typeof WRITING_WORKFLOW_SCHEMA_VERSION;
  packageId: string;
  packageVersion: number;
  materials: string;
  axis: string;
  design: string;
  reviews: WritingWorkflowReview[];
}

export interface WritingWorkflowStepState {
  key: WritingWorkflowStep;
  label: string;
  content: string;
  signature: string;
  approved: boolean;
  canEdit: boolean;
  canApprove: boolean;
  blocker: string;
  lastReview: WritingWorkflowReview | null;
}

export interface WritingWorkflowState {
  packageId: string | null;
  packageVersion: number | null;
  packageTitle: string;
  packageCopy: string;
  packageReady: boolean;
  currentPackage: boolean;
  steps: WritingWorkflowStepState[];
  ready: boolean;
  nextAction: string;
  blocker: string;
}

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

export function writingWorkflowOf(value: unknown): WritingWorkflow {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const reviews = Array.isArray(raw.reviews) ? raw.reviews.filter((item): item is WritingWorkflowReview => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const review = item as Record<string, unknown>;
    return WRITING_WORKFLOW_STEPS.includes(review.step as WritingWorkflowStep)
      && typeof review.signature === "string"
      && typeof review.approved === "boolean"
      && typeof review.actorId === "string"
      && typeof review.at === "string"
      && typeof review.note === "string";
  }) : [];
  return {
    schemaVersion: WRITING_WORKFLOW_SCHEMA_VERSION,
    packageId: typeof raw.packageId === "string" ? raw.packageId : "",
    packageVersion: Number.isSafeInteger(raw.packageVersion) && Number(raw.packageVersion) > 0 ? Number(raw.packageVersion) : 0,
    materials: text(raw.materials),
    axis: text(raw.axis),
    design: text(raw.design),
    reviews,
  };
}

export function writingStepLabel(step: WritingWorkflowStep) {
  return ({
    package: "패키징 확정",
    materials: "자료 탐색",
    axis: "핵심 축 검토",
    design: "영상 설계",
  } as const)[step];
}
