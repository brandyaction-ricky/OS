import type { OsRecord } from "./record-types";

export const PIPELINE_GATES = ["소재·근거 승인", "원고·패키징 승인", "최종 영상·발행키트 승인"] as const;
export type PipelineAction = "topic_plan" | "script_draft" | "title_package" | "shorts_proposal" | "youtube_kit";
export interface PipelineReview { gate: number; signature: string; approved: boolean; actorId: string; at: string; note: string }
export interface PipelineRun { key: string; action: string; state: "running" | "succeeded" | "failed" | "needs_input"; at: string; finishedAt?: string; error?: string; recordIds?: string[] }

export function pipelineArtifacts(records: OsRecord[]) {
  const latest = (match: (record: OsRecord) => boolean) => records.filter((record) => !record.archived_at && match(record)).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))[0] ?? null;
  return {
    research: latest((record) => record.metadata.packageKind === "topic_plan"),
    script: latest((record) => record.record_type === "content_script"),
    packaging: latest((record) => record.metadata.packageKind === "title_package"),
    kit: latest((record) => record.metadata.packageKind === "youtube_kit"),
    clips: records.filter((record) => !record.archived_at && record.record_type === "content_short" && record.metadata.selected !== false),
  };
}

export function pipelineMissing(source: OsRecord, records: OsRecord[], gate: number) {
  const artifacts = pipelineArtifacts(records); const missing: string[] = [];
  if (!String(source.metadata.audience ?? "").trim()) missing.push("타깃 시청자");
  if (!String(source.metadata.evidence ?? "").trim()) missing.push("확인한 자료·출처");
  if (!String(source.metadata.experience ?? "").trim()) missing.push("실제 경험·사례 (해당 없으면 사유)");
  if (!artifacts.research) missing.push("기획 브리핑");
  if (gate >= 2 && !artifacts.script?.description.trim()) missing.push("원고");
  if (gate >= 2 && !artifacts.packaging) missing.push("제목·썸네일 패키지");
  if (gate >= 3 && !artifacts.kit) missing.push("발행키트");
  if (gate >= 3 && !/^https:\/\//.test(String(source.metadata.finalVideoUrl ?? ""))) missing.push("검토할 최종 영상 HTTPS URL");
  return missing;
}

export function hasCurrentApproval(reviews: PipelineReview[], gate: number, signature: string) {
  const latest = reviews.filter((review) => review.gate === gate).at(-1);
  return latest?.approved === true && latest.signature === signature;
}

export const PIPELINE_PROTECTED_KEYS = ["pipelineReviews", "pipelineRuns"];
export function protectedPipelineChange(current: Record<string, unknown>, proposed?: Record<string, unknown>) {
  return !!proposed && ((current.pipelineEnabled === true && proposed.pipelineEnabled !== true) || PIPELINE_PROTECTED_KEYS.some((key) => JSON.stringify(current[key]) !== JSON.stringify(proposed[key])));
}
