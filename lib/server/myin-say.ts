import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import type { OsRecord } from "@/lib/record-types";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { RequestActor } from "./auth";
import { editorProject } from "./myin-edit";
import { fishVoice, myinSayTarget } from "./myin-run";
import { YOUTUBE_VOICE_BUCKET } from "./youtube-voice-run";

// 문장 테이크 (로건 개발 문서 v3 7.2-1, his first ask): a few sentences read again in a video's own voice — the render PC's Fish key,
// the narration's generation, tone EQ and reading dictionary — k takes each with how far its end rises, so the editor on a member's
// computer can put a new line in or fix one's intonation. Nothing in the OS video changes; the takes are the editor's to use.
// The end height is information only: a person listens and picks (대표 2026-11-04 — in the first test the ear chose the take with the
// highest end, the one a "calmest ending" rule ranked last).

type Service = ReturnType<typeof createServiceSupabase>;
const SAY = "youtube_myin_say";
const LEASE_MS = 10 * 60_000;
const takeSchema = z.object({ i: z.number().int().min(0), k: z.number().int().min(0), path: z.string(), seconds: z.number().positive(), rise: z.number().nullable() }).strict();
// voiceReference: the run's channel voice (다채널 2단계), so the takes sound like the rest of the video.
const sayMeta = z.object({ kind: z.literal(SAY), projectId: z.string().uuid(), runId: z.string().uuid(), sentences: z.array(z.string()), takes: z.number().int(), voiceReference: z.string().optional(),
  by: z.string().uuid(), name: z.string(), status: z.enum(["queued", "working", "done", "failed"]),
  lease: z.object({ token: z.string().uuid(), expiresAt: z.string() }).strict().optional(), result: z.array(takeSchema).optional(), error: z.string().optional() }).passthrough();
type SayMeta = z.infer<typeof sayMeta>;

export const sayRequestSchema = z.object({ sentences: z.array(z.string().trim().min(1).max(300)).min(1).max(5), takes: z.number().int().min(1).max(3).default(3) }).strict();
const takePath = (owner: string, projectId: string, sayId: string, i: number, k: number) => `${owner}/${projectId}/say/${sayId}/s${i}_t${k}.wav`;

async function save(service: Service, row: { id: string; version: number }, meta: SayMeta, status: string) {
  const { data } = await service.from("os_records").update({ metadata: meta, status }).eq("id", row.id).eq("version", row.version).select("id").maybeSingle();
  return Boolean(data);
}

/** Asks the render PC for the takes. Anyone who may edit the video (or their AI key) may ask; it costs a few won of Fish per take. */
export async function requestSay(actor: RequestActor, projectId: string, input: z.infer<typeof sayRequestSchema>) {
  const project = await editorProject(actor, projectId);
  const service = createServiceSupabase();
  const target = await myinSayTarget(service, project.id);
  const { data: row } = await service.from("os_records").select("owner_id,team,brand").eq("id", project.id).maybeSingle();
  if (!row) throw new ApiError(404, "VIDEO_NOT_FOUND", "영상을 찾지 못했어요.");
  const { data: who } = await service.from("os_profiles").select("display_name").eq("id", actor.ownerId).maybeSingle();
  const id = randomUUID();
  const meta: SayMeta = { kind: SAY, projectId: project.id, runId: target.runId, sentences: input.sentences, takes: input.takes, ...(target.voiceReference ? { voiceReference: target.voiceReference } : {}), by: actor.ownerId,
    name: String(who?.display_name ?? "구성원"), status: "queued" };
  const { error } = await service.from("os_records").insert({ id, record_type: "ai_job", title: `문장 테이크 · ${input.sentences[0]}`.slice(0, 240), description: "", status: "backlog",
    priority: "normal", team: row.team, brand: row.brand, owner_id: row.owner_id, parent_id: project.id, created_by: actor.ownerId, updated_by: actor.ownerId, tags: ["유튜브", "영상편집기"], metadata: meta });
  if (error) throw new ApiError(500, "MYIN_SAY_FAILED", "문장 테이크 요청을 저장하지 못했어요.");
  return { sayId: id, status: "queued" as const };
}

/** Where the request is; once done, each take in the order it was made, with a 30-minute address and its end height. */
export async function sayStatus(actor: RequestActor, projectId: string, sayId: string) {
  const project = await editorProject(actor, projectId);
  const service = createServiceSupabase();
  const { data } = await service.from("os_records").select("id,metadata").eq("id", sayId).eq("parent_id", project.id).eq("metadata->>kind", SAY).maybeSingle();
  if (!data) throw new ApiError(404, "MYIN_SAY_NOT_FOUND", "문장 테이크 요청을 찾지 못했어요.");
  const meta = sayMeta.parse(data.metadata);
  const takes = meta.status === "done" ? await Promise.all((meta.result ?? []).map(async (take) => {
    const { data: signed } = await service.storage.from(YOUTUBE_VOICE_BUCKET).createSignedUrl(take.path, 1_800);
    return { i: take.i, k: take.k, seconds: take.seconds, rise: take.rise, url: signed?.signedUrl ?? null };
  })) : [];
  return { sayId, status: meta.status, sentences: meta.sentences, takes: takes.sort((a, b) => a.i - b.i || a.k - b.k), error: meta.error ?? null };
}

// ── render PC ──
export const sayWorkerSchemas = [
  z.object({ action: z.literal("myin_say_claim") }).strict(),
  z.object({ action: z.literal("myin_say_complete"), sayId: z.string().uuid(), lease: z.string().uuid(),
    takes: z.array(z.object({ i: z.number().int().min(0).max(4), k: z.number().int().min(0).max(2), seconds: z.number().positive().max(120), rise: z.number().nullable() }).strict()).min(1).max(15) }).strict(),
  z.object({ action: z.literal("myin_say_fail"), sayId: z.string().uuid(), lease: z.string().uuid(), code: z.string().max(80) }).strict(),
] as const;

/** The oldest waiting request (or one whose render PC went quiet), with an upload address for every take. */
export async function claimSay(service: Service = createServiceSupabase()) {
  const { data } = await service.from("os_records").select("id,version,owner_id,metadata").eq("record_type", "ai_job").eq("metadata->>kind", SAY)
    .in("metadata->>status", ["queued", "working"]).is("archived_at", null).order("created_at", { ascending: true }).limit(10);
  for (const row of (data ?? []) as Pick<OsRecord, "id" | "version" | "owner_id" | "metadata">[]) {
    const meta = sayMeta.parse(row.metadata);
    if (meta.status === "working" && meta.lease && Date.parse(meta.lease.expiresAt) > Date.now()) continue;
    const token = randomUUID();
    if (!await save(service, row, { ...meta, status: "working", lease: { token, expiresAt: new Date(Date.now() + LEASE_MS).toISOString() } }, "backlog")) continue;
    const storage = service.storage.from(YOUTUBE_VOICE_BUCKET);
    const uploads = await Promise.all(meta.sentences.map((_, i) => Promise.all(Array.from({ length: meta.takes }, async (_, k) => {
      const { data: signed, error } = await storage.createSignedUploadUrl(takePath(row.owner_id ?? "", meta.projectId, row.id, i, k), { upsert: true });
      if (error || !signed) throw new ApiError(503, "MYIN_SIGN_FAILED", "업로드 주소를 만들지 못했습니다.");
      return signed.signedUrl;
    }))));
    return { sayId: row.id, lease: token, sentences: meta.sentences, takes: meta.takes, fishVoice: fishVoice(meta), uploads };
  }
  return { idle: true as const };
}

async function leased(service: Service, sayId: string, lease: string) {
  const { data } = await service.from("os_records").select("id,version,owner_id,metadata").eq("id", sayId).eq("metadata->>kind", SAY).maybeSingle();
  const meta = data ? sayMeta.parse(data.metadata) : null;
  if (!data || !meta || meta.status !== "working" || meta.lease?.token !== lease) throw new ApiError(409, "MYIN_SAY_LEASE", "이 문장 테이크 작업은 이미 다른 곳에서 처리했어요.");
  return { row: data as Pick<OsRecord, "id" | "version" | "owner_id">, meta };
}

export async function completeSay(input: { sayId: string; lease: string; takes: { i: number; k: number; seconds: number; rise: number | null }[] }, service: Service = createServiceSupabase()) {
  const { row, meta } = await leased(service, input.sayId, input.lease);
  const folder = `${row.owner_id}/${meta.projectId}/say/${row.id}`;
  const { data: listed } = await service.storage.from(YOUTUBE_VOICE_BUCKET).list(folder, { limit: 100 });
  const kept = new Set((listed ?? []).filter((o) => Number(o.metadata?.size ?? 0) > 0).map((o) => o.name));
  const result = input.takes.filter((t) => t.i < meta.sentences.length && t.k < meta.takes).map((t) => ({ ...t, path: takePath(row.owner_id ?? "", meta.projectId, row.id, t.i, t.k) }));
  if (!result.length || result.some((t) => !kept.has(t.path.slice(folder.length + 1)))) throw new ApiError(409, "MYIN_SAY_UPLOAD_MISSING", "문장 테이크 파일이 다 올라가지 않았어요.");
  const next: SayMeta = { ...meta, status: "done", result }; delete next.lease;
  if (!await save(service, row, next, "done")) throw new ApiError(409, "RECORD_VERSION_CONFLICT", "다른 곳에서 먼저 바꿨어요.");
  return { ok: true };
}

export async function failSay(input: { sayId: string; lease: string; code: string }, service: Service = createServiceSupabase()) {
  const { row, meta } = await leased(service, input.sayId, input.lease);
  const next: SayMeta = { ...meta, status: "failed", error: input.code }; delete next.lease;
  await save(service, row, next, "blocked");
  return { ok: true };
}
