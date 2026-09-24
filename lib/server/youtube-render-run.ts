import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import type { OsRecord } from "@/lib/record-types";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { RequestActor } from "./auth";
import { YOUTUBE_VISUAL_TEMPLATE_VERSION } from "@/lib/youtube-visual-template";
import { validateSceneSvg } from "@/lib/youtube-scene-svg";
import { YOUTUBE_CHARACTER_BUCKET, youtubeCharacterCatalogSchema } from "./youtube-characters";
import { scenePlanSchema } from "./youtube-scenes";
import { alignYoutubeVisualBeats, createYoutubeRenderBrief, createYoutubeTimedTranscriptFromFish } from "./youtube-timeline";
import { digestVoiceValue, parseVoiceRun, voiceRunId, YOUTUBE_VOICE_BUCKET, YOUTUBE_VOICE_RUN_KIND, YOUTUBE_VOICE_TIMING_BUCKET } from "./youtube-voice-run";
import { currentSegments } from "./youtube-voice-worker";

// A render run turns one finished voice run into a private MP4. The media worker
// holds only a worker secret; every read and verification happens here.
export const YOUTUBE_RENDER_RUN_KIND = "youtube_narration_render_v1";
export const YOUTUBE_VIDEO_BUCKET = "os-youtube-video";
const LEASE_MS = 45 * 60_000;
type Service = ReturnType<typeof createServiceSupabase>;

const hex = z.string().regex(/^[a-f0-9]{64}$/);
const renderRunSchema = z.object({
  kind: z.literal(YOUTUBE_RENDER_RUN_KIND), voiceRunId: z.string().uuid(), sourceId: z.string().uuid(),
  scenePlanGeneratedAt: z.string().datetime(), templateVersion: z.literal(YOUTUBE_VISUAL_TEMPLATE_VERSION),
  audioPath: z.string(), videoPath: z.string(), audioSha256: hex.optional(), durationSeconds: z.number().positive().optional(),
  videoBytes: z.number().int().positive().optional(), videoSha256: hex.optional(),
  lease: z.object({ token: z.string().uuid(), expiresAt: z.string().datetime() }).strict().optional(),
  attempts: z.number().int().min(0).max(20), lastError: z.object({ code: z.string(), at: z.string().datetime() }).strict().optional(),
}).strict();
type RenderRun = z.infer<typeof renderRunSchema>;

const sha256 = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

async function download(service: Service, bucket: string, path: string) {
  const { data, error } = await service.storage.from(bucket).download(path);
  if (error || !data) throw new ApiError(409, "RENDER_ASSET_MISSING", "영상 제작에 필요한 비공개 자산을 찾지 못했습니다.");
  return Buffer.from(await data.arrayBuffer());
}

async function signedRead(service: Service, bucket: string, path: string) {
  const { data, error } = await service.storage.from(bucket).createSignedUrl(path, 1_800);
  if (error || !data) throw new ApiError(503, "RENDER_SIGN_FAILED", "비공개 자산 주소를 만들지 못했습니다.");
  return data.signedUrl;
}

async function signedUpload(service: Service, path: string) {
  const { data, error } = await service.storage.from(YOUTUBE_VIDEO_BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data) throw new ApiError(503, "RENDER_SIGN_FAILED", "업로드 주소를 만들지 못했습니다.");
  return data.signedUrl;
}

async function save(service: Service, record: OsRecord, status: string, stage: string, metadata: RenderRun) {
  const { data, error } = await service.from("os_records").update({ status, stage, metadata, updated_by: record.owner_id })
    .eq("id", record.id).eq("version", record.version).is("archived_at", null).select("*").maybeSingle();
  if (error || !data) throw new ApiError(409, "RENDER_RUN_CHANGED", "영상 제작 작업이 먼저 변경됐습니다.");
  return data as OsRecord;
}

async function leased(service: Service, renderId: string, token: string) {
  const { data } = await service.from("os_records").select("*").eq("id", renderId).eq("record_type", "ai_job").is("archived_at", null).maybeSingle();
  const parsed = renderRunSchema.safeParse(data?.metadata);
  if (!data || !parsed.success || parsed.data.lease?.token !== token || Date.parse(parsed.data.lease.expiresAt) < Date.now())
    throw new ApiError(409, "RENDER_LEASE_LOST", "영상 제작 작업의 처리 권한이 만료됐습니다.");
  return { record: data as OsRecord, run: parsed.data };
}

/** Create or claim the render run for one finished voice run, and hand the worker its inputs. */
export async function claimYoutubeRender(service: Service = createServiceSupabase()) {
  const { data: voiceRuns, error } = await service.from("os_records").select("*").eq("record_type", "ai_job")
    .eq("metadata->>kind", YOUTUBE_VOICE_RUN_KIND).eq("status", "done").eq("stage", "voice_ready").is("archived_at", null).order("updated_at").limit(20);
  if (error) throw new ApiError(500, "RENDER_QUEUE_READ_FAILED", "영상 제작 대기열을 읽지 못했습니다.");
  for (const candidate of voiceRuns ?? []) {
    const voiceRecord = candidate as OsRecord;
    let voice;
    try { voice = parseVoiceRun(voiceRecord); } catch { continue; }
    if (!voice.timingMode || !voiceRecord.owner_id) continue;
    const id = voiceRunId(digestVoiceValue([YOUTUBE_RENDER_RUN_KIND, voiceRecord.id, voice.scenePlanGeneratedAt, YOUTUBE_VISUAL_TEMPLATE_VERSION]));
    const base = `${voiceRecord.owner_id}/${voice.sourceId}/${id}`;
    let { data: existing } = await service.from("os_records").select("*").eq("id", id).maybeSingle();
    if (!existing) {
      const metadata: RenderRun = { kind: YOUTUBE_RENDER_RUN_KIND, voiceRunId: voiceRecord.id, sourceId: voice.sourceId,
        scenePlanGeneratedAt: voice.scenePlanGeneratedAt, templateVersion: YOUTUBE_VISUAL_TEMPLATE_VERSION,
        audioPath: `${base}/narration.mp3`, videoPath: `${base}/video.mp4`, attempts: 0 };
      const { data: created } = await service.from("os_records").insert({
        id, record_type: "ai_job", title: `${voiceRecord.title.replace(/ · 내레이션 제작$/, "")} · 영상 제작`.slice(0, 240),
        description: "승인된 원고의 음성과 화면 설계로 비공개 영상을 만드는 작업입니다.", status: "backlog", stage: "render_pending",
        priority: "normal", brand: voiceRecord.brand, team: voiceRecord.team, owner_id: voiceRecord.owner_id, parent_id: voice.sourceId,
        created_by: voiceRecord.owner_id, updated_by: voiceRecord.owner_id, tags: ["유튜브", "영상제작"], metadata,
      }).select("*").maybeSingle();
      existing = created;
    }
    const parsed = renderRunSchema.safeParse(existing?.metadata);
    if (!existing || !parsed.success || !["backlog", "in_progress"].includes(existing.status)) continue;
    if (parsed.data.lease && Date.parse(parsed.data.lease.expiresAt) > Date.now()) continue;
    if (parsed.data.attempts >= 3) { await save(service, existing as OsRecord, "blocked", "failed", parsed.data); continue; }
    const lease = { token: randomUUID(), expiresAt: new Date(Date.now() + LEASE_MS).toISOString() };
    const claimed = await save(service, existing as OsRecord, "in_progress", "rendering",
      { ...parsed.data, lease, attempts: parsed.data.attempts + 1 }).catch(() => null);
    if (!claimed) continue;
    const segments = [];
    for (const segment of voice.segments) {
      if (segment.status !== "ready" || !segment.path) throw new ApiError(409, "RENDER_VOICE_INCOMPLETE", "음성 단락이 모두 준비되지 않았습니다.");
      segments.push({ index: segment.index, url: await signedRead(service, YOUTUBE_VOICE_BUCKET, segment.path) });
    }
    return { renderId: id, lease: lease.token, segments, audioUploadUrl: await signedUpload(service, parsed.data.audioPath) };
  }
  return { idle: true as const };
}

/** Verify the worker's assembled narration against every segment artifact and return the render brief. */
export async function buildYoutubeRenderBrief(input: { renderId: string; lease: string; segmentDurations: number[]; durationSeconds: number },
  service: Service = createServiceSupabase()) {
  const { record, run } = await leased(service, input.renderId, input.lease);
  const { data: voiceRecord } = await service.from("os_records").select("*").eq("id", run.voiceRunId).maybeSingle();
  if (!voiceRecord) throw new ApiError(409, "RENDER_VOICE_MISSING", "음성 제작 작업을 찾지 못했습니다.");
  const voice = parseVoiceRun(voiceRecord as OsRecord);
  const scriptSegments = await currentSegments(service, voiceRecord as OsRecord, voice);
  if (input.segmentDurations.length !== voice.segments.length) throw new ApiError(409, "RENDER_AUDIO_MISMATCH", "음성 단락 수가 맞지 않습니다.");
  const segments = [];
  let offset = 0;
  for (const [index, segment] of voice.segments.entries()) {
    // ponytail: offsets are cumulative measured durations of a stream-copy concat; MP3 frame padding stays within the 0.25s checks.
    segments.push({ audio: await download(service, YOUTUBE_VOICE_BUCKET, segment.path ?? ""),
      timing: JSON.parse((await download(service, YOUTUBE_VOICE_TIMING_BUCKET, segment.timingPath ?? "")).toString("utf8")),
      offsetSeconds: offset, measuredDurationSeconds: input.segmentDurations[index] });
    offset += input.segmentDurations[index];
  }
  const finalAudio = await download(service, YOUTUBE_VIDEO_BUCKET, run.audioPath);
  const transcript = createYoutubeTimedTranscriptFromFish({ scriptSegments, finalAudio, finalDurationSeconds: input.durationSeconds, segments });
  const { data: source } = await service.from("os_records").select("metadata").eq("id", run.sourceId).maybeSingle();
  const stored = (source?.metadata as Record<string, unknown> | undefined)?.narratedScenePlan as { plan?: unknown; generatedAt?: unknown; templateVersion?: unknown } | undefined;
  const plan = scenePlanSchema.safeParse(stored?.plan);
  if (!plan.success || stored?.generatedAt !== run.scenePlanGeneratedAt || stored?.templateVersion !== YOUTUBE_VISUAL_TEMPLATE_VERSION)
    throw new ApiError(409, "RENDER_SCENE_PLAN_CHANGED", "화면 설계가 음성 제작 이후 변경됐습니다. 새 작업이 필요합니다.");
  const brief = createYoutubeRenderBrief(plan.data, alignYoutubeVisualBeats(plan.data, scriptSegments, transcript, sha256(finalAudio)));
  const catalogBytes = await download(service, YOUTUBE_CHARACTER_BUCKET, "catalog.json");
  const catalog = youtubeCharacterCatalogSchema.parse(JSON.parse(catalogBytes.toString("utf8")));
  const ids = new Set(catalog.assets.filter((asset) => asset.usable).map((asset) => asset.id));
  const used = new Set(brief.timeline.beats.flatMap((beat) => { const svg = validateSceneSvg(beat.svg, ids); return svg.ok ? svg.summary.characters : []; }));
  const characters: Record<string, string> = {};
  for (const asset of catalog.assets) if (used.has(asset.id)) characters[asset.file] = await signedRead(service, YOUTUBE_CHARACTER_BUCKET, asset.file);
  await save(service, record, "in_progress", "rendering", { ...run, audioSha256: sha256(finalAudio), durationSeconds: input.durationSeconds });
  return { brief, catalog, characters, videoUploadUrl: await signedUpload(service, run.videoPath) };
}

/** Record a finished upload after checking the stored object size the worker reported. */
export async function completeYoutubeRender(input: { renderId: string; lease: string; videoBytes: number; videoSha256: string },
  service: Service = createServiceSupabase()) {
  const { record, run } = await leased(service, input.renderId, input.lease);
  const folder = run.videoPath.slice(0, run.videoPath.lastIndexOf("/"));
  const { data } = await service.storage.from(YOUTUBE_VIDEO_BUCKET).list(folder, { search: "video.mp4", limit: 2 });
  const stored = data?.find((item) => item.name === "video.mp4");
  if (!stored || Number(stored.metadata?.size) !== input.videoBytes || !hex.safeParse(input.videoSha256).success)
    throw new ApiError(409, "RENDER_VIDEO_MISMATCH", "업로드된 영상의 크기가 보고된 값과 다릅니다.");
  const next: RenderRun = { ...run, videoBytes: input.videoBytes, videoSha256: input.videoSha256, attempts: 0 };
  delete next.lease;
  delete next.lastError;
  await save(service, record, "done", "render_ready", next);
  return { renderId: record.id, stage: "render_ready" };
}

export async function failYoutubeRender(input: { renderId: string; lease: string; code: string }, service: Service = createServiceSupabase()) {
  const { record, run } = await leased(service, input.renderId, input.lease);
  const next: RenderRun = { ...run, lastError: { code: input.code.replace(/[^A-Z0-9_]/g, "").slice(0, 60) || "RENDER_WORKER_FAILED", at: new Date().toISOString() } };
  delete next.lease;
  const blocked = run.attempts >= 3;
  await save(service, record, blocked ? "blocked" : "backlog", blocked ? "failed" : "render_pending", next);
  return { renderId: record.id, retry: !blocked };
}

/** Anyone the OS lets read the content may open its latest rendered video for 10 minutes. */
export async function openYoutubeRenderedVideo(supabase: RequestActor["supabase"], sourceId: string) {
  const { data: source } = await supabase.from("os_records").select("id").eq("id", sourceId).eq("record_type", "content_topic").is("archived_at", null).maybeSingle();
  if (!source) throw new ApiError(404, "CONTENT_SOURCE_NOT_FOUND", "콘텐츠를 찾지 못했거나 볼 권한이 없습니다.");
  const service = createServiceSupabase();
  const { data: runs } = await service.from("os_records").select("metadata,updated_at").eq("record_type", "ai_job").eq("parent_id", sourceId)
    .eq("metadata->>kind", YOUTUBE_RENDER_RUN_KIND).eq("stage", "render_ready").is("archived_at", null).order("updated_at", { ascending: false }).limit(1);
  const run = renderRunSchema.safeParse(runs?.[0]?.metadata);
  if (!run.success) throw new ApiError(404, "RENDERED_VIDEO_NOT_FOUND", "아직 완성된 영상이 없습니다.");
  const { data, error } = await service.storage.from(YOUTUBE_VIDEO_BUCKET).createSignedUrl(run.data.videoPath, 600);
  if (error || !data) throw new ApiError(503, "RENDER_SIGN_FAILED", "영상 주소를 만들지 못했습니다.");
  return { url: data.signedUrl, expiresInSeconds: 600, videoSha256: run.data.videoSha256 };
}
