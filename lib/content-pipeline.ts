import type { OsRecord } from "./record-types";

export const PIPELINE_GATES = ["기획·제목·썸네일 검토", "설계·제작 자료 검토", "최종 영상·발행키트 승인"] as const;
const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
export function usesShootingPlan(source: Pick<OsRecord, "metadata">) {
  return object(source.metadata.planningHandoff).productionFormat === "board" || object(source.metadata.productionPreparation).kind === "shooting_plan";
}
export function packagingChoiceMissing(record: OsRecord | null) {
  const result = object(record?.metadata.result);
  const picked = (value: unknown) => Array.isArray(value) ? value.filter(item => object(item).picked === true && typeof object(item).text === "string" && String(object(item).text).trim()) : [];
  const missing: string[] = [];
  if (picked(result.titles).length !== 1) missing.push("채택한 제목 1개");
  if (!picked(result.copies).length) missing.push("채택한 썸네일 카피");
  return missing;
}
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
  if (!artifacts.packaging) missing.push("제목·썸네일 패키지");
  else missing.push(...packagingChoiceMissing(artifacts.packaging));
  if (gate >= 2) {
    if (usesShootingPlan(source)) {
      const preparation = object(source.metadata.productionPreparation);
      if (typeof preparation.design !== "string" || !preparation.design.trim()) missing.push("영상 설계");
      if (typeof preparation.shootingPlan !== "string" || !preparation.shootingPlan.trim()) missing.push("촬영 진행표");
    } else if (!artifacts.script?.description.trim()) missing.push("원고");
  }
  if (gate >= 3 && !artifacts.kit) missing.push("발행키트");
  if (gate >= 3 && !/^https:\/\//.test(String(source.metadata.finalVideoUrl ?? ""))) missing.push("검토할 최종 영상 HTTPS URL");
  return missing;
}

export function hasCurrentApproval(reviews: PipelineReview[], gate: number, signature: string) {
  const latest = reviews.filter((review) => review.gate === gate).at(-1);
  return latest?.approved === true && latest.signature === signature;
}

export type PipelineSourceFields = { title?: unknown; description?: unknown; source_url?: unknown; metadata: Record<string, unknown> };
export type PipelineSourceUpdate = { title?: unknown; description?: unknown; sourceUrl?: unknown; metadata?: Record<string, unknown> };
const GATE_1_KEYS = ["audience", "evidence", "experience", "coreMessage", "planningHandoff", "productionFormatChange"];
const GATE_3_KEYS = ["finalVideoUrl", "transcriptSrt", "transcript", "shortsStyle"];
export function nextPipelineInputRevisions(current: PipelineSourceFields, proposed: PipelineSourceUpdate): number[] | null {
  const metadata = proposed.metadata;
  const changed = (key: string) => metadata !== undefined && JSON.stringify(current.metadata[key]) !== JSON.stringify(metadata[key]);
  const first = (proposed.title !== undefined && proposed.title !== current.title)
    || (proposed.description !== undefined && proposed.description !== current.description)
    || (proposed.sourceUrl !== undefined && proposed.sourceUrl !== current.source_url)
    || GATE_1_KEYS.some(changed);
  const second = changed("productionPreparation");
  const third = GATE_3_KEYS.some(changed);
  if (!first && !second && !third) return null;
  const previous = Array.isArray(current.metadata.pipelineInputRevisions) ? current.metadata.pipelineInputRevisions : [];
  return [first, second, third].map((value, index) => {
    const count = previous[index];
    return (Number.isSafeInteger(count) && count >= 0 ? count : 0) + Number(value);
  });
}

export const PIPELINE_PROTECTED_KEYS = ["pipelineReviews", "pipelineRuns", "pipelineInputRevisions"];
export function protectedPipelineChange(current: Record<string, unknown>, proposed?: Record<string, unknown>) {
  return !!proposed && ((current.pipelineEnabled === true && proposed.pipelineEnabled !== true) || PIPELINE_PROTECTED_KEYS.some((key) => JSON.stringify(current[key]) !== JSON.stringify(proposed[key])));
}
