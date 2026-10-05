import type { OsRecord } from "./record-types";
import { appealApprovalMatches, researchBriefReady } from "./content-appeals.ts";
import type { ScriptReviewState } from "./content-script-review.ts";
import type { ProductionWorkflowState } from "./content-production-workflow.ts";
import type { WritingWorkflowState } from "./content-writing-workflow.ts";

export const PIPELINE_GATES = ["기획·근거 승인", "패키징·자료·설계·원고 승인", "최종 영상·발행키트 승인"] as const;
export type PipelineAction = "topic_plan" | "script_draft" | "title_package" | "shorts_proposal" | "youtube_kit";
export interface PipelineReview { gate: number; signature: string; approved: boolean; actorId: string; at: string; note: string }
export interface PipelineRun { key: string; action: string; state: "running" | "queued" | "succeeded" | "failed" | "needs_input"; at: string; finishedAt?: string; error?: string; recordIds?: string[] }

export function pipelineArtifacts(records: OsRecord[]) {
  const latest = (match: (record: OsRecord) => boolean) => records.filter((record) => !record.archived_at && match(record)).sort((a, b) => b.created_at.localeCompare(a.created_at) || b.id.localeCompare(a.id))[0] ?? null;
  return {
    appeals: latest((record) => record.metadata.packageKind === "appeal_candidates"),
    research: latest((record) => record.metadata.packageKind === "topic_plan"),
    script: latest((record) => record.record_type === "content_script"),
    packaging: latest((record) => record.metadata.packageKind === "title_package"),
    kit: latest((record) => record.metadata.packageKind === "youtube_kit"),
    clips: records.filter((record) => !record.archived_at && record.record_type === "content_short" && record.metadata.selected !== false),
  };
}

function resultOf(record: OsRecord | null) {
  const result = record?.metadata.result;
  return result && typeof result === "object" ? result as Record<string, unknown> : {};
}

export function pickedPlanningCandidate(record: OsRecord | null) {
  const candidates = resultOf(record).candidates;
  if (!Array.isArray(candidates)) return null;
  const picked = candidates.filter((candidate) => candidate && typeof candidate === "object" && (candidate as Record<string, unknown>).picked === true);
  return picked.length === 1 ? picked[0] as Record<string, unknown> : null;
}

export function planningSelectionReady(source: OsRecord, plan: OsRecord | null) {
  const picked = pickedPlanningCandidate(plan);
  const sourcePicked = source.metadata.pickedCandidate;
  return Boolean(plan && picked && sourcePicked && typeof sourcePicked === "object"
    && source.metadata.planningPackageId === plan.id
    && Number(source.metadata.planningPackageVersion) === plan.version
    && JSON.stringify(sourcePicked) === JSON.stringify(picked));
}

export function pickedPackaging(record: OsRecord | null) {
  const result = resultOf(record);
  const picked = (key: "titles" | "copies") => Array.isArray(result[key])
    ? (result[key] as Array<Record<string, unknown>>).filter((candidate) => candidate?.picked === true)
    : [];
  const titles = picked("titles");
  const copies = picked("copies");
  return { title: titles.length === 1 ? titles[0] : null, copy: copies.length === 1 ? copies[0] : null, ready: titles.length === 1 && copies.length === 1 };
}

export function pipelineMissing(source: OsRecord, records: OsRecord[], gate: number, writing?: WritingWorkflowState, scriptReview?: ScriptReviewState, production?: ProductionWorkflowState) {
  const artifacts = pipelineArtifacts(records); const missing: string[] = [];
  const brief = source.metadata.researchBrief;
  const briefRecord = brief && typeof brief === "object" ? brief as Record<string, unknown> : {};
  const hasApprovedAppeal = appealApprovalMatches(artifacts.appeals?.metadata.result && typeof artifacts.appeals.metadata.result === "object" ? (artifacts.appeals.metadata.result as Record<string, unknown>).candidates : null, briefRecord);
  const matchesCurrentAppeal = Boolean(artifacts.appeals && briefRecord.appealPackageId === artifacts.appeals.id && Number(briefRecord.appealPackageVersion) === artifacts.appeals.version);
  if (!String(source.metadata.audience ?? "").trim()) missing.push("타깃 시청자");
  if (!String(source.metadata.evidence ?? "").trim()) missing.push("확인한 자료·출처");
  if (!String(source.metadata.experience ?? "").trim()) missing.push("실제 경험·사례 (해당 없으면 사유)");
  if (!hasApprovedAppeal || !matchesCurrentAppeal || !researchBriefReady(briefRecord)) missing.push("소구점 승인·레퍼런스 검증");
  if (!artifacts.research) missing.push("기획 브리핑");
  if (artifacts.research && !planningSelectionReady(source, artifacts.research)) missing.push("채택한 기획 방향");
  if (gate >= 2 && !artifacts.packaging) missing.push("제목·썸네일 패키지");
  if (gate >= 2 && artifacts.packaging && !pickedPackaging(artifacts.packaging).ready) missing.push("채택한 제목·썸네일 카피");
  if (gate >= 2 && writing) {
    for (const step of writing.steps) if (!step.approved) missing.push(step.label);
  }
  if (gate >= 2 && !artifacts.script?.description.trim()) missing.push("원고");
  if (gate >= 2 && scriptReview) {
    for (const step of scriptReview.steps) if (!step.approved) missing.push(`${step.label} 검수`);
  }
  if (gate >= 3 && !artifacts.kit) missing.push("발행키트");
  if (gate >= 3 && artifacts.kit) {
    const checklist = resultOf(artifacts.kit).checklist;
    const checked = Array.isArray(artifacts.kit.metadata.checkedItems) ? artifacts.kit.metadata.checkedItems : [];
    if (Array.isArray(checklist) && checklist.length > 0 && checklist.some((_, index) => !checked.includes(index))) missing.push("발행키트 업로드 체크리스트");
  }
  if (gate >= 3 && production) {
    for (const step of production.steps) if (!step.approved) missing.push(step.label);
  }
  if (gate >= 3 && !/^https:\/\//.test(String(source.metadata.finalVideoUrl ?? ""))) missing.push("검토할 최종 영상 HTTPS URL");
  return missing;
}

export function hasCurrentApproval(reviews: PipelineReview[], gate: number, signature: string) {
  const latest = reviews.filter((review) => review.gate === gate).at(-1);
  return latest?.approved === true && latest.signature === signature;
}

export const PIPELINE_PROTECTED_KEYS = ["pipelineReviews", "pipelineRuns", "writingWorkflow", "scriptReviewWorkflow", "productionWorkflow", "releaseWorkflow", "channelWorkflowVersion", "publicationApproval", "publishCheckpoint", "publishOperation", "externalIds", "postedBy", "publishedAt", "mockPublished"];
export function protectedPipelineChange(current: Record<string, unknown>, proposed?: Record<string, unknown>) {
  return !!proposed && ((current.pipelineEnabled === true && proposed.pipelineEnabled !== true) || PIPELINE_PROTECTED_KEYS.some((key) => JSON.stringify(current[key]) !== JSON.stringify(proposed[key])));
}
