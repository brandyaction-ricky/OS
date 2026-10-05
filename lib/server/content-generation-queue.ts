import { createHash, randomUUID } from "node:crypto";
import { ApiError } from "@/lib/http";
import type { RequestActor } from "./auth";
import type { OsRecord } from "@/lib/record-types";
import type { ContentAutomationSettings } from "@/lib/content-automation-settings";

export function generationJobId(key: string) {
  const hex = createHash("sha256").update(`os-content-generation:${key}`).digest("hex");
  return `${hex.slice(0,8)}-${hex.slice(8,12)}-5${hex.slice(13,16)}-a${hex.slice(17,20)}-${hex.slice(20,32)}`;
}

export async function beginGenerationJob(actor: RequestActor, source: OsRecord, input: Record<string, unknown>, procedure: string, requestKey?: string, automation?: ContentAutomationSettings) {
  const mode = input.mode === "api" ? "api" : "queue";
  const procedureHash = createHash("sha256").update(procedure).digest("hex");
  const key = requestKey ?? createHash("sha256").update(JSON.stringify([source.id, source.version, input, procedureHash])).digest("hex");
  // Queue retries reuse the primary key; concurrent inserts cannot enqueue twice.
  const id = mode === "queue" ? generationJobId(`${actor.id}:${key}`) : randomUUID();
  const payload = {
    id, record_type: "ai_job", title: `${source.title} · ${String(input.action)}`.slice(0,240),
    description: mode === "queue" ? "회사 정본을 읽고 초안·검토 결과를 저장할 구독 대기 작업입니다. 외부 발행은 하지 않습니다." : "바로 받기를 명시적으로 요청한 API 생성 기록입니다.",
    status: mode === "queue" ? "backlog" : "active", stage: mode === "queue" ? "queued" : "running", priority: "normal",
    parent_id: source.id, brand: source.brand, team: source.team || actor.team,
    owner_id: actor.id, created_by: actor.id, updated_by: actor.id,
    metadata: { contentAction: input.action, sourceId: source.id, sourceVersion: source.version, generationMode: mode, generationId: id, generationRequestKey: key, procedureHash, input, automation: automation ? { retryLimit: automation.retryLimit, promptPrefix: automation.promptPrefix, shorts: automation.shorts } : undefined, retryLimit: automation?.retryLimit ?? 0, attempt: 0, generatedBy: mode === "queue" ? "claude-queue" : "claude-api", finalApprovalRequired: true, requestedAt: new Date().toISOString(), costUsd: null },
    tags: ["콘텐츠", "AI", mode === "queue" ? "구독대기열" : "바로받기"],
  };
  const { data, error } = await actor.supabase.from("os_records").insert(payload).select("*").single();
  if (error?.code === "23505" && mode === "queue") {
    const { data: existing, error: readError } = await actor.supabase.from("os_records").select("*").eq("id",id).maybeSingle();
    if (!readError && existing && !existing.archived_at) return existing as OsRecord;
  }
  if (error || !data) throw new ApiError(400, "CONTENT_JOB_QUEUE_FAILED", "생성 요청을 저장하지 못했습니다. API는 실행하지 않았습니다.");
  return data as OsRecord;
}

export async function finishGenerationJob(actor: RequestActor, job: OsRecord, records: OsRecord[], usage: Record<string, unknown>, failureCode?: string) {
  const { data, error } = await actor.supabase.from("os_records").update({
    status: failureCode ? "blocked" : "done", stage: failureCode ? "failed" : "completed", progress: failureCode ? 0 : 100,
    updated_by: actor.id, metadata: { ...job.metadata, ...usage, recordIds: records.map(record => record.id), finishedAt: new Date().toISOString(), ...(failureCode ? { failureCode } : {}) },
  }).eq("id", job.id).eq("version", job.version).select("id").maybeSingle();
  if (error || !data) throw new ApiError(409, "GENERATION_LOG_CHANGED", "결과 저장 뒤 작업 기록이 변경됐습니다. AI 작업에서 결과를 확인해 주세요.");
}
