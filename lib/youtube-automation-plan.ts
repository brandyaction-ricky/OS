import { createHash } from "node:crypto";
import { pickedPackaging, pipelineArtifacts } from "./content-pipeline.ts";
import type { OsRecord } from "./record-types";

export interface YoutubeAutomationPipelineState {
  source: OsRecord;
  records: OsRecord[];
  signatures: string[];
  approved: boolean[];
}

export interface YoutubeAutomationPlan {
  format: "narrated_visual";
  privacyStatus: "private";
  judgmentMode: "advisory_only";
  sourceId: string;
  inputKey: string | null;
  currentStage: "needs_input" | "ready_for_voice";
  missing: string[];
  script: { id: string; version: number } | null;
  packaging: { id: string; version: number } | null;
  kit: null;
}

/**
 * Read-only plan from the content pipeline: a narrated video starts only from the script and title/thumbnail
 * a person approved at gates 1 and 2. The input key changes whenever either approval or either record changes.
 */
export function buildYoutubeAutomationPlan(state: YoutubeAutomationPipelineState): YoutubeAutomationPlan {
  const { source, records, approved, signatures } = state;
  const artifacts = pipelineArtifacts(records);
  const picked = pickedPackaging(artifacts.packaging);
  const missing: string[] = [];
  if (source.metadata.pipelineEnabled !== true) missing.push("제작 공정 시작");
  if (!approved[0]) missing.push("기획·근거 승인");
  if (!artifacts.packaging || !picked.ready) missing.push("채택한 제목·썸네일 카피");
  if (!artifacts.script?.description.trim()) missing.push("원고");
  if (!approved[1]) missing.push("패키징·자료·설계·원고 승인");
  const script = artifacts.script ? { id: artifacts.script.id, version: artifacts.script.version } : null;
  const packaging = artifacts.packaging ? { id: artifacts.packaging.id, version: artifacts.packaging.version } : null;
  const inputKey = !missing.length && script && packaging
    ? createHash("sha256").update(JSON.stringify(["narrated-visual-v2", source.id, signatures[0], signatures[1], script, packaging])).digest("hex")
    : null;
  return { format: "narrated_visual", privacyStatus: "private", judgmentMode: "advisory_only", sourceId: source.id,
    inputKey, currentStage: inputKey ? "ready_for_voice" : "needs_input", missing, script, packaging, kit: null };
}

/** The key a linked script document gives a run: the document's id, version and content at the time it was linked. */
export function documentInputKey(sourceId: string, doc: { id: unknown; version: unknown; contentSha256: unknown }) {
  return createHash("sha256").update(JSON.stringify(["narrated-document-v1", sourceId, doc.id, doc.version, doc.contentSha256])).digest("hex");
}

/** The input key a voice or v13 run must carry to count for the current approvals (document-backed or pipeline script). */
export function automationInputKey(state: YoutubeAutomationPipelineState) {
  const ref = state.source.metadata.scriptDocument as { id?: unknown; version?: unknown; contentSha256?: unknown } | undefined;
  return ref ? documentInputKey(state.source.id, { id: ref.id, version: ref.version, contentSha256: ref.contentSha256 }) : buildYoutubeAutomationPlan(state).inputKey;
}
