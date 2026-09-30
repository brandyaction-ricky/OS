export const SCRIPT_REVIEW_SCHEMA_VERSION = 1 as const;

export const SCRIPT_REVIEW_STEPS = ["claim", "evidence", "audience", "expression"] as const;
export type ScriptReviewStep = (typeof SCRIPT_REVIEW_STEPS)[number];

export interface ScriptReviewDecision {
  step: ScriptReviewStep;
  signature: string;
  approved: boolean;
  actorId: string;
  at: string;
  note: string;
}

export interface ScriptReviewWorkflow {
  schemaVersion: typeof SCRIPT_REVIEW_SCHEMA_VERSION;
  scriptId: string;
  scriptVersion: number;
  claim: string;
  evidence: string;
  audience: string;
  expression: string;
  reviews: ScriptReviewDecision[];
}

export interface ScriptReviewStepState {
  key: ScriptReviewStep;
  label: string;
  content: string;
  signature: string;
  approved: boolean;
  canEdit: boolean;
  canApprove: boolean;
  blocker: string;
  lastReview: ScriptReviewDecision | null;
}

export interface ScriptReviewState {
  scriptId: string | null;
  scriptVersion: number | null;
  scriptTitle: string;
  currentScript: boolean;
  steps: ScriptReviewStepState[];
  ready: boolean;
  nextAction: string;
  blocker: string;
}

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

export function scriptReviewWorkflowOf(value: unknown): ScriptReviewWorkflow {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const reviews = Array.isArray(raw.reviews) ? raw.reviews.filter((item): item is ScriptReviewDecision => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return false;
    const review = item as Record<string, unknown>;
    return SCRIPT_REVIEW_STEPS.includes(review.step as ScriptReviewStep)
      && typeof review.signature === "string"
      && typeof review.approved === "boolean"
      && typeof review.actorId === "string"
      && typeof review.at === "string"
      && typeof review.note === "string";
  }) : [];
  return {
    schemaVersion: SCRIPT_REVIEW_SCHEMA_VERSION,
    scriptId: typeof raw.scriptId === "string" ? raw.scriptId : "",
    scriptVersion: Number.isSafeInteger(raw.scriptVersion) && Number(raw.scriptVersion) > 0 ? Number(raw.scriptVersion) : 0,
    claim: text(raw.claim),
    evidence: text(raw.evidence),
    audience: text(raw.audience),
    expression: text(raw.expression),
    reviews,
  };
}

export function scriptReviewStepLabel(step: ScriptReviewStep) {
  return ({
    claim: "주장",
    evidence: "근거",
    audience: "타깃",
    expression: "표현",
  } as const)[step];
}
