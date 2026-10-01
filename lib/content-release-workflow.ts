export const RELEASE_WORKFLOW_SCHEMA_VERSION = 1;

export interface ReleasePlan {
  kitId: string;
  kitVersion: number;
  finalReviewSignature: string;
  channelId: string;
  channelTitle: string;
  privacyStatus: "private" | "unlisted";
  scheduledAt: string;
}

export interface ReleaseDecision {
  signature: string;
  approved: boolean;
  actorId: string;
  at: string;
  note: string;
}

export interface ReleaseWorkflow {
  schemaVersion: number;
  plan: ReleasePlan | null;
  decisions: ReleaseDecision[];
}

export interface ReleaseWorkflowState {
  plan: ReleasePlan | null;
  signature: string;
  approved: boolean;
  canApprove: boolean;
  blocker: string;
  nextAction: string;
  lastDecision: ReleaseDecision | null;
}

const text = (value: unknown) => typeof value === "string" ? value.trim() : "";

export function releaseWorkflowOf(value: unknown): ReleaseWorkflow {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const planRaw = raw.plan && typeof raw.plan === "object" && !Array.isArray(raw.plan) ? raw.plan as Record<string, unknown> : null;
  const privacy = planRaw?.privacyStatus;
  const plan = planRaw && ["private", "unlisted"].includes(String(privacy)) ? {
    kitId: text(planRaw.kitId),
    kitVersion: Number(planRaw.kitVersion) || 0,
    finalReviewSignature: text(planRaw.finalReviewSignature),
    channelId: text(planRaw.channelId),
    channelTitle: text(planRaw.channelTitle),
    privacyStatus: privacy as ReleasePlan["privacyStatus"],
    scheduledAt: text(planRaw.scheduledAt),
  } : null;
  const decisions = Array.isArray(raw.decisions) ? raw.decisions.filter((item): item is ReleaseDecision => Boolean(item && typeof item === "object"
    && text((item as Record<string, unknown>).signature)
    && typeof (item as Record<string, unknown>).approved === "boolean")) : [];
  return { schemaVersion: RELEASE_WORKFLOW_SCHEMA_VERSION, plan, decisions };
}
