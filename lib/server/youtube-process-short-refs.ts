import { randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import type { OsRecord } from "@/lib/record-types";
import { createServiceSupabase } from "@/lib/supabase/server";
import { editableFields } from "@/lib/youtube-process/confirm";
import { packagingPick } from "@/lib/youtube-process/discover";
import { projectName } from "@/lib/youtube-process/project";
import { refHostOk, type YpShortRefFetch } from "@/lib/youtube-process/short-script";
import type { RequestActor } from "./auth";
import { packagingReferences } from "./youtube-discover";
import { getYoutubeProject, readFailed } from "./youtube-process";
import { readStages } from "./youtube-process-stages";

// 숏폼 대본 정본 §2-2 (owner direction 2026-10-28): "제목만 보면 안 돼. 썸네일 카피, 화면 첫 부분 헤드 카피가 가장 중요해." The PD's
// [레퍼런스 받기] hands the top Shorts for the search words and the PD's own links (Shorts · Reels · TikTok · Meta 광고 라이브러리) to the
// render PC, which keeps each one's thumbnail, a sheet of its first three seconds and what is said (yt-dlp + faster-whisper), and
// deletes the video. The 대본 job's card then shows these to the staff AI.
type Service = ReturnType<typeof createServiceSupabase>;
export const SHORT_REFS_KIND = "short_refs_v1";
const BUCKET = "os-content-media";
const MARKET_TAKE = 6;
const MAX_REFS = 10;
const LEASE_MS = 15 * 60_000;
const imagePath = (projectId: string, jobId: string, index: number, kind: "thumb" | "sheet") => `youtube/${projectId}/refs/${jobId}/${index}-${kind}.jpg`;

interface RefsJob {
  kind: typeof SHORT_REFS_KIND; projectId: string; query: string; items: YpShortRefFetch["items"]; attempts: number; requestedAt: string;
  lease?: { token: string; expiresAt: string }; doneAt?: string; error?: string;
}
const jobOf = (row: OsRecord) => row.metadata as unknown as RefsJob;

async function latestJob(service: Service, projectId: string) {
  const { data, error } = await service.from("os_records").select("*").eq("record_type", "ai_job").eq("metadata->>kind", SHORT_REFS_KIND).eq("parent_id", projectId)
    .is("archived_at", null).order("created_at", { ascending: false }).limit(1);
  if (error) throw readFailed();
  return (data?.[0] ?? null) as OsRecord | null;
}

/** [레퍼런스 받기] on the 대본 step: the market search for the 검색어 (Shorts first) plus the PD's links, frozen into one render PC job. */
export async function requestShortRefs(actor: RequestActor, projectId: string) {
  const project = await getYoutubeProject(actor, projectId);
  if (project.yp.topic.type !== "short" || project.yp.stage !== "draft" || editableFields(project, "draft") !== "all")
    throw new ApiError(409, "STAGE_LOCKED", "대본 단계에서 레퍼런스를 받을 수 있어요.");
  const script = (await readStages(actor.supabase, project)).shortScript.data;
  const query = script.query.trim() || projectName(project);
  const market = packagingPick(await packagingReferences(query), true).filter(ref => ref.short).slice(0, MARKET_TAKE);
  const own = script.refs.filter(ref => refHostOk(ref.url)).map(ref => ({ url: ref.url, title: ref.title, channel: "", views: null, ratio: null, source: "pd" as const }));
  const items = [...own, ...market.map(ref => ({ url: ref.url, title: ref.title, channel: ref.channel, views: ref.views, ratio: ref.ratio, source: "market" as const }))]
    .filter((item, index, list) => list.findIndex(other => other.url === item.url) === index).slice(0, MAX_REFS).map(item => ({ ...item, result: null }));
  if (!items.length) throw new ApiError(409, "SHORT_REFS_EMPTY", `「${query}」로 찾은 쇼츠가 없어요. 검색어를 바꾸거나 링크를 직접 넣어 주세요.`);
  const service = createServiceSupabase();
  const before = await latestJob(service, project.id);
  if (before && ["backlog", "in_progress"].includes(before.status)) await service.from("os_records").update({ status: "cancelled", updated_by: actor.id }).eq("id", before.id);
  const metadata: RefsJob = { kind: SHORT_REFS_KIND, projectId: project.id, query, items, attempts: 0, requestedAt: new Date().toISOString() };
  const { data, error } = await service.from("os_records").insert({ id: randomUUID(), record_type: "ai_job", title: `${projectName(project)} · 숏폼 레퍼런스 받기`.slice(0, 240),
    description: "렌더 PC가 레퍼런스의 썸네일 · 첫 3초 화면 · 대사를 받아 둡니다.", status: "backlog", stage: "queued", priority: "normal", parent_id: project.id,
    owner_id: actor.id, created_by: actor.id, updated_by: actor.id, team: actor.team, tags: ["유튜브", "숏폼", "레퍼런스"], metadata }).select("*").single();
  if (error || !data) throw new ApiError(400, "SHORT_REFS_CREATE_FAILED", "레퍼런스 받기를 시작하지 못했어요.");
  return shortRefsView(service, data as OsRecord, 3600);
}

/** What the 대본 step (1 hour links) and the staff AI's card (3 days, it may claim later) show of the latest job. */
export async function shortRefsView(service: Service, row: OsRecord, linkSeconds: number): Promise<YpShortRefFetch> {
  const job = jobOf(row);
  const sign = async (index: number, kind: "thumb" | "sheet") => {
    const { data } = await service.storage.from(BUCKET).createSignedUrl(imagePath(job.projectId, row.id, index, kind), linkSeconds);
    return data?.signedUrl ?? null;
  };
  const items = await Promise.all(job.items.map(async (item, index) => item.result?.ok
    ? { ...item, thumbUrl: item.result.thumb ? await sign(index, "thumb") : null, sheetUrl: item.result.sheet ? await sign(index, "sheet") : null } : item));
  return { id: row.id, status: row.status, query: job.query, requestedAt: job.requestedAt, doneAt: job.doneAt ?? null, error: job.error ?? null, items };
}
export async function readShortRefs(actor: RequestActor, projectId: string) {
  const project = await getYoutubeProject(actor, projectId);
  const service = createServiceSupabase();
  const row = await latestJob(service, project.id);
  return row ? shortRefsView(service, row, 3600) : null;
}
/** The finished references a 대본 job reads (the newest done job), or null. */
export async function doneShortRefs(service: Service, projectId: string, linkSeconds = 3 * 86_400) {
  const { data, error } = await service.from("os_records").select("*").eq("record_type", "ai_job").eq("metadata->>kind", SHORT_REFS_KIND).eq("parent_id", projectId)
    .eq("status", "done").is("archived_at", null).order("created_at", { ascending: false }).limit(1);
  if (error) throw readFailed();
  return data?.[0] ? shortRefsView(service, data[0] as OsRecord, linkSeconds) : null;
}

// ── The render PC (media worker secret) ──
async function save(service: Service, row: OsRecord, status: string, metadata: RefsJob) {
  const { data, error } = await service.from("os_records").update({ status, metadata, updated_by: row.owner_id }).eq("id", row.id).eq("version", row.version).select("*").maybeSingle();
  if (error) throw readFailed();
  return data as OsRecord | null;
}
export async function claimShortRefs(service: Service = createServiceSupabase()) {
  const { data, error } = await service.from("os_records").select("*").eq("record_type", "ai_job").eq("metadata->>kind", SHORT_REFS_KIND)
    .in("status", ["backlog", "in_progress"]).is("archived_at", null).order("created_at", { ascending: true }).limit(10);
  if (error) throw readFailed();
  for (const row of (data ?? []) as OsRecord[]) {
    const job = jobOf(row);
    if (row.status === "in_progress" && job.lease && Date.parse(job.lease.expiresAt) > Date.now()) continue;
    if (job.attempts >= 3) { await save(service, row, "blocked", { ...job, lease: undefined, error: job.error ?? "WORKER_TIMEOUT" }); continue; }
    const lease = { token: randomUUID(), expiresAt: new Date(Date.now() + LEASE_MS).toISOString() };
    const claimed = await save(service, row, "in_progress", { ...job, lease, attempts: job.attempts + 1 });
    if (!claimed) continue;
    const storage = service.storage.from(BUCKET);
    const uploads = await Promise.all(job.items.map(async (_, index) => Object.fromEntries(await Promise.all((["thumb", "sheet"] as const).map(async kind => {
      const { data: signed, error: signError } = await storage.createSignedUploadUrl(imagePath(job.projectId, row.id, index, kind), { upsert: true });
      if (signError || !signed) throw new ApiError(503, "SHORT_REFS_SIGN_FAILED", "레퍼런스 이미지 업로드 주소를 만들지 못했어요.");
      return [kind, signed.signedUrl];
    })))));
    return { jobId: row.id, lease: lease.token, items: job.items.map((item, index) => ({ index, url: item.url, ...uploads[index] })) };
  }
  return { idle: true as const };
}

const resultSchema = z.object({ index: z.number().int().min(0).max(MAX_REFS - 1), ok: z.boolean(), title: z.string().max(300).default(""),
  durationSeconds: z.number().min(0).max(36_000).nullable().default(null), transcript: z.string().max(6000).default(""),
  thumb: z.boolean().default(false), sheet: z.boolean().default(false), error: z.string().max(200).default("") }).strict();
export const shortRefsCompleteSchema = z.object({ action: z.literal("short_refs_complete"), jobId: z.string().uuid(), lease: z.string().uuid(), results: z.array(resultSchema).max(MAX_REFS) }).strict();
export const shortRefsFailSchema = z.object({ action: z.literal("short_refs_fail"), jobId: z.string().uuid(), lease: z.string().uuid(), code: z.string().max(80) }).strict();
async function leased(service: Service, jobId: string, token: string) {
  const { data, error } = await service.from("os_records").select("*").eq("id", jobId).eq("record_type", "ai_job").eq("metadata->>kind", SHORT_REFS_KIND).maybeSingle();
  if (error) throw readFailed();
  const row = data as OsRecord | null;
  if (!row || row.status !== "in_progress" || jobOf(row).lease?.token !== token) throw new ApiError(409, "SHORT_REFS_LEASE", "이 레퍼런스 작업을 가져간 기록이 없어요.");
  return row;
}
export async function completeShortRefs(input: z.infer<typeof shortRefsCompleteSchema>, service: Service = createServiceSupabase()) {
  const row = await leased(service, input.jobId, input.lease);
  const job = jobOf(row);
  const byIndex = new Map(input.results.map(result => [result.index, result]));
  const items = job.items.map((item, index) => {
    const result = byIndex.get(index);
    return { ...item, title: item.title || result?.title || "", result: result ? { ok: result.ok, durationSeconds: result.durationSeconds, transcript: result.transcript, thumb: result.thumb, sheet: result.sheet, error: result.error } : { ok: false, durationSeconds: null, transcript: "", thumb: false, sheet: false, error: "결과 없음" } };
  });
  await save(service, row, "done", { ...job, items, lease: undefined, doneAt: new Date().toISOString() });
  return { jobId: row.id, ok: items.filter(item => item.result?.ok).length, of: items.length };
}
export async function failShortRefs(input: z.infer<typeof shortRefsFailSchema>, service: Service = createServiceSupabase()) {
  const row = await leased(service, input.jobId, input.lease);
  const job = jobOf(row);
  await save(service, row, job.attempts >= 3 ? "blocked" : "backlog", { ...job, lease: undefined, error: input.code });
  return { jobId: row.id };
}
