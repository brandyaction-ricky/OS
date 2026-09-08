import { createHash } from "node:crypto";
import type { z } from "zod";
import { ApiError } from "@/lib/http";
import { hasCurrentApproval, pipelineArtifacts, pipelineMissing, type PipelineReview, type PipelineRun } from "@/lib/content-pipeline";
import type { OsRecord } from "@/lib/record-types";
import type { RequestActor } from "./auth";
import { executeGeneration, generationProcedureRevision, generationSchema } from "./content-generation";

function digest(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex"); }
function sourceInput(source: OsRecord) {
  return { title: source.title, description: source.description, sourceUrl: source.source_url,
    audience: source.metadata.audience, evidence: source.metadata.evidence, experience: source.metadata.experience, coreMessage: source.metadata.coreMessage };
}
function reference(record: OsRecord | null) { return record ? [record.id, record.version] : null; }
export function gateSignature(source: OsRecord, records: OsRecord[], gate: number) {
  const artifacts = pipelineArtifacts(records);
  return digest([sourceInput(source), reference(artifacts.research), ...(gate >= 2 ? [reference(artifacts.script), reference(artifacts.packaging)] : []),
    ...(gate >= 3 ? [reference(artifacts.kit), artifacts.clips.map(reference).sort(), source.metadata.finalVideoUrl, source.metadata.transcriptSrt, source.metadata.shortsStyle] : [])]);
}

export async function readPipeline(actor: RequestActor, id: string) {
  const { data: source, error } = await actor.supabase.from("os_records").select("*").eq("id", id).eq("record_type", "content_topic").is("archived_at", null).maybeSingle();
  if (error || !source) throw new ApiError(404, "CONTENT_SOURCE_NOT_FOUND", "기준 콘텐츠를 찾지 못했습니다.");
  const records: OsRecord[] = [];
  for (let offset = 0; ; offset += 200) {
    const { data, error: childError } = await actor.supabase.from("os_records").select("*").eq("parent_id", id).is("archived_at", null).order("id").range(offset, offset + 199);
    if (childError) throw new ApiError(500, "PIPELINE_READ_FAILED", "공정 산출물을 읽지 못했습니다.");
    records.push(...(data ?? [])); if (!data || data.length < 200) break;
  }
  const reviews = (Array.isArray(source.metadata.pipelineReviews) ? source.metadata.pipelineReviews : []) as PipelineReview[];
  const signatures = [1, 2, 3].map((gate) => gateSignature(source, records, gate));
  const matches = signatures.map((signature, index) => hasCurrentApproval(reviews, index + 1, signature));
  const approved = matches.map((_, index) => matches.slice(0, index + 1).every(Boolean));
  return { source: source as OsRecord, records, reviews, signatures, approved, missing: [1, 2, 3].map((gate) => pipelineMissing(source, records, gate)) };
}

async function saveMetadata(actor: RequestActor, source: OsRecord, changes: Record<string, unknown>) {
  const { data, error } = await actor.supabase.from("os_records").update({ metadata: { ...source.metadata, ...changes }, updated_by: actor.id })
    .eq("id", source.id).eq("version", source.version).is("archived_at", null).select("*").maybeSingle();
  if (error) throw new ApiError(500, "PIPELINE_SAVE_FAILED", "공정 이력을 저장하지 못했습니다.");
  if (!data) throw new ApiError(409, "PIPELINE_CHANGED", "다른 작업이 먼저 변경했습니다. 새로 불러와 주세요.");
  return data as OsRecord;
}

export async function reviewPipeline(actor: RequestActor, id: string, gate: number, signature: string, approved: boolean, note: string) {
  const state = await readPipeline(actor, id);
  if (state.source.metadata.pipelineEnabled !== true) throw new ApiError(409, "PIPELINE_NOT_ENABLED", "공정을 먼저 시작해 주세요.");
  if (state.signatures[gate - 1] !== signature) throw new ApiError(409, "PIPELINE_CHANGED", "검토 중 자료가 변경되었습니다. 최신 산출물을 확인해 주세요.");
  if (approved && (state.missing[gate - 1].length || state.approved.slice(0, gate - 1).some((value) => !value)))
    throw new ApiError(409, "PIPELINE_NEEDS_INPUT", `승인 전 확인 필요: ${state.missing[gate - 1].join(", ") || "이전 단계 승인"}`);
  if (!approved && !note.trim()) throw new ApiError(400, "REVIEW_REASON_REQUIRED", "수정 요청 사유를 입력해 주세요.");
  const review: PipelineReview = { gate, signature, approved, actorId: actor.id, at: new Date().toISOString(), note };
  return saveMetadata(actor, state.source, { pipelineReviews: [...state.reviews, review] });
}

export async function runPipelineGeneration(actor: RequestActor, input: z.infer<typeof generationSchema>) {
  const state = await readPipeline(actor, input.sourceId);
  const neededGate = ({ topic_plan: 0, script_draft: 1, title_package: 1, shorts_proposal: 2, youtube_kit: 2, derivatives: 2 })[input.action];
  if (state.approved.slice(0, neededGate).some((approved) => !approved)) throw new ApiError(409, "PIPELINE_APPROVAL_REQUIRED", "이전 단계의 현재 자료를 승인한 뒤 실행해 주세요. 수정된 자료는 재승인이 필요합니다.");
  if (input.action === "topic_plan") {
    const missing = pipelineMissing(state.source, state.records, 1).filter((name) => name !== "기획 브리핑");
    if (missing.length) throw new ApiError(409, "PIPELINE_NEEDS_INPUT", `자료 보완 필요: ${missing.join(", ")}`);
  }
  if (input.action === "title_package" && !pipelineArtifacts(state.records).script) throw new ApiError(409, "PIPELINE_NEEDS_INPUT", "원고를 먼저 작성해 주세요.");
  const artifacts = pipelineArtifacts(state.records);
  const procedureRevision = await generationProcedureRevision(actor, input.action);
  const key = digest([procedureRevision, input.action, sourceInput(state.source), input.count, input.platforms, input.marketEvidence,
    ...(input.action === "topic_plan" ? [] : [reference(artifacts.research)]),
    ...(["title_package", "shorts_proposal", "youtube_kit", "derivatives"].includes(input.action) ? [reference(artifacts.script)] : []),
    ...(["shorts_proposal", "youtube_kit"].includes(input.action) ? [state.source.metadata.transcriptSrt] : [])]);
  const runs = (Array.isArray(state.source.metadata.pipelineRuns) ? state.source.metadata.pipelineRuns : []) as PipelineRun[];
  const prior = runs.findLast((run) => run.key === key);
  if (prior?.state === "succeeded") return { configured: true, queued: false, reused: true, records: state.records.filter((record) => prior.recordIds?.includes(record.id)) };
  if (runs.some((run) => run.state === "running" && Date.now() - Date.parse(run.at) < 180_000)) throw new ApiError(409, "PIPELINE_RUNNING", "콘텐츠 생성이 진행 중입니다. 잠시 후 새로 불러와 주세요.");
  const run: PipelineRun = { key, action: input.action, state: "running", at: new Date().toISOString() };
  // A compare-and-swap on the shared source serializes runs. Expired attempts remain in history.
  await saveMetadata(actor, state.source, { pipelineRuns: [...runs.map((item) => item.state === "running" ? { ...item, state: "failed" as const, error: "실행 시간 초과" } : item), run] });
  const finish = async (changes: Partial<PipelineRun>) => {
    for (let attempt = 0; attempt < 3; attempt++) {
      const latest = await readPipeline(actor, input.sourceId);
      const currentRuns = latest.source.metadata.pipelineRuns as PipelineRun[];
      try { await saveMetadata(actor, latest.source, { pipelineRuns: currentRuns.map((item) => item.key === key && item.at === run.at ? { ...item, ...changes, finishedAt: new Date().toISOString() } : item) }); return; }
      catch (error) { if (!(error instanceof ApiError) || error.code !== "PIPELINE_CHANGED" || attempt === 2) throw error; }
    }
  };
  try {
    // Recover artifacts saved before an interrupted completion write without generating twice.
    const recovered = state.records.filter((record) => record.metadata.generationRequestKey === key);
    const result = recovered.length ? { queued: false, configured: true, records: recovered } : await executeGeneration(actor, input, key);
    await finish({ state: result.queued ? "needs_input" : "succeeded", recordIds: result.records.map((record) => record.id), ...(result.queued ? { error: "Claude 연결 필요" } : {}) });
    return result;
  } catch (error) {
    await finish({ state: error instanceof ApiError && [409, 503].includes(error.status) ? "needs_input" : "failed", error: error instanceof Error ? error.message : "생성 실패" });
    throw error;
  }
}
