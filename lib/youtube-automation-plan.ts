import { createHash } from "node:crypto";
import { selectedPackaging } from "./content-selected-packaging";
import { pipelineArtifacts, usesShootingPlan } from "./content-pipeline";
import type { OsRecord } from "./record-types";

export interface YoutubeAutomationPipelineState {
  source: OsRecord;
  records: OsRecord[];
  signatures: string[];
  approved: boolean[];
  missing: string[][];
}

export interface YoutubeAutomationPlan {
  format: "narrated_visual";
  privacyStatus: "private";
  judgmentMode: "advisory_only";
  sourceId: string;
  inputKey: string | null;
  currentStage: "needs_input" | "ready_for_voice" | "ready_for_review" | "ready_for_private_upload";
  missing: string[];
  script: { id: string; version: number } | null;
  packaging: { id: string; version: number } | null;
  kit: { id: string; version: number } | null;
}

/** Build a read-only plan from existing OS artifacts and human approvals. No provider call occurs here. */
export function buildYoutubeAutomationPlan(state: YoutubeAutomationPipelineState): YoutubeAutomationPlan {
  const { source, records, approved, signatures } = state;
  const artifacts = pipelineArtifacts(records);
  const selection = selectedPackaging(records, source.id);
  const missing: string[] = [];
  if (source.metadata.pipelineEnabled !== true) missing.push("제작 공정 시작");
  if (usesShootingPlan(source)) missing.push("내 목소리 영상용 전문 원고");
  if (!approved[0]) missing.push("현재 기획·패키징 승인");
  if (!selection || !artifacts.packaging) missing.push("채택한 제목·썸네일 카피");
  if (!artifacts.script?.description.trim()) missing.push("전문 원고");
  if (!approved[1]) missing.push("현재 원고·제작 자료 승인");
  const inputsReady = missing.length === 0;
  const script = artifacts.script ? { id: artifacts.script.id, version: artifacts.script.version } : null;
  const packaging = artifacts.packaging ? { id: artifacts.packaging.id, version: artifacts.packaging.version } : null;
  const kit = artifacts.kit ? { id: artifacts.kit.id, version: artifacts.kit.version } : null;
  const inputKey = inputsReady && script && packaging
    ? createHash("sha256").update(JSON.stringify(["narrated-visual-v1", source.id, signatures[0], signatures[1], script, packaging, selection])).digest("hex")
    : null;
  const finalVideo = typeof source.metadata.finalVideoUrl === "string" && /^https:\/\//.test(source.metadata.finalVideoUrl);
  const mediaReady = Boolean(finalVideo && kit);
  const currentStage = !inputsReady ? "needs_input" : !mediaReady ? "ready_for_voice" : !approved[2] ? "ready_for_review" : "ready_for_private_upload";
  return {
    format: "narrated_visual", privacyStatus: "private", judgmentMode: "advisory_only", sourceId: source.id,
    inputKey, currentStage, missing, script, packaging, kit,
  };
}
