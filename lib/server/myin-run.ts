import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { myinCleanScript, myinScriptMarkdown } from "@/lib/myin-script";
import { MYIN_METAPHOR_TYPES } from "@/lib/myin-storyboard";
import type { OsRecord } from "@/lib/record-types";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { RequestActor } from "./auth";
import { synthesizeFishWav } from "./fish-audio";
import { readYoutubeAutomationInput } from "./youtube-automation-input";
import { digestVoiceValue, voiceRunId, YOUTUBE_VOICE_BUCKET, YOUTUBE_VOICE_TIMING_BUCKET } from "./youtube-voice-run";

// 마이인 v13 (owner decision 2026-10-19: the default format; design https://claude.ai/artifact/NCJ5qjYNeBYgfwjCnm1JgQ).
// One run per approved script. Stage 1: the OS server asks Fish for each paragraph exactly as Logan's stage_voice.py does and
// keeps the wav (voice_pending); the render PC then runs his pipeline unchanged on those files — voice post-processing, words.json
// and subtitles — and sends back one JSON bundle (words_pending → words_ready). The voice is frozen from here: Fish never reads a
// line the same way twice, and every later cue is matched against this transcription.
export const MYIN_RUN_KIND = "youtube_myin_v13";
export const MYIN_VOICE_MODEL = "drama-3"; // pinned like Logan: Fish serves an unknown model name as 2.1 without an error
const WORDS_LEASE_MS = 30 * 60_000;
type Service = ReturnType<typeof createServiceSupabase>;

const hex = z.string().regex(/^[a-f0-9]{64}$/);
const versionRef = z.object({ id: z.string().uuid(), version: z.number().int().positive() }).strict();
const leaseSchema = z.object({ token: z.string().uuid(), expiresAt: z.string().datetime() }).strict();
const runSchema = z.object({
  kind: z.literal(MYIN_RUN_KIND), runKey: hex, sourceId: z.string().uuid(), inputKey: hex, script: versionRef, scriptMarkdownHash: hex,
  voiceModel: z.literal(MYIN_VOICE_MODEL), voiceReferenceFingerprint: hex,
  paragraphs: z.array(z.object({ index: z.number().int().min(0), textHash: hex, status: z.enum(["pending", "ready"]), path: z.string().optional(), bytes: z.number().int().positive().optional() }).strict()).min(1).max(150),
  words: z.object({ path: z.string(), words: z.number().int().positive(), subtitleLines: z.number().int().min(0), durationSeconds: z.number().positive(), at: z.string().datetime() }).strict().optional(),
  // Stage 2: the staff AI's storyboard (kept in the voice-timing bucket) and what Logan sees to confirm it.
  storyboard: z.object({ path: z.string(), scenes: z.number().int().positive(), model: z.string(), at: z.string().datetime(),
    metaphors: z.array(z.object({ scene: z.number().int(), type: z.string(), at: z.string() }).strict()),
    cta: z.array(z.object({ after: z.string(), line: z.string() }).strict()),
    summary: z.object({ title: z.string(), points: z.array(z.string()) }).strict().nullable(),
    reasons: z.object({ metaphors: z.string(), cta: z.string(), summary: z.string() }).strict(),
    assets: z.array(z.object({ kind: z.enum(["people", "situations", "bgm"]), file: z.string(), url: z.string(), source: z.string(), license: z.string(), use: z.string() }).strict()),
    fuzzy: z.array(z.string()), notes: z.array(z.string()) }).strict().optional(),
  review: z.object({ decision: z.enum(["confirmed", "revise"]), by: z.string().uuid(), name: z.string(), note: z.string(), at: z.string().datetime() }).strict().optional(),
  // Stage 3: each candidate's download decision (by file name), files people uploaded (Pixabay blocks automated downloads),
  // the CTA lines' voice, and the render PC's preparation with Logan's preview check.
  assets: z.record(z.string(), z.object({ decision: z.enum(["approved", "excluded"]), by: z.string().uuid(), at: z.string().datetime(),
    path: z.string().optional(), bytes: z.number().int().positive().optional() }).strict()).optional(),
  cta: z.array(z.object({ index: z.number().int().min(0), textHash: hex, status: z.enum(["pending", "ready"]), path: z.string().optional() }).strict()).optional(),
  prepared: z.object({ path: z.string(), misses: z.array(z.string()), sheets: z.array(z.string()), credits: z.array(z.string()), at: z.string().datetime() }).strict().optional(),
  lease: leaseSchema.optional(), attempts: z.number().int().min(0).max(20),
  lastError: z.object({ code: z.string(), at: z.string().datetime() }).strict().optional(),
}).strict();
type MyinRun = z.infer<typeof runSchema>;

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
const parse = (record: Pick<OsRecord, "metadata">) => {
  const result = runSchema.safeParse(record.metadata);
  if (!result.success) throw new ApiError(409, "MYIN_RUN_INVALID", "저장된 v13 작업을 읽을 수 없습니다.");
  return result.data;
};
const paragraphPath = (record: OsRecord, run: MyinRun, index: number) => `${record.owner_id}/${run.sourceId}/${record.id}/p${String(index).padStart(2, "0")}.wav`;

/** The approved script as Logan's pipeline reads it, and the paragraphs his stage_voice speaks. */
async function currentInput(supabase: Service | RequestActor["supabase"], sourceId: string) {
  const { state, plan, scriptText } = await readYoutubeAutomationInput(supabase, sourceId);
  if (!plan.inputKey || !plan.script || !scriptText) throw new ApiError(409, "AUTOMATION_INPUT_CHANGED", "승인된 원고와 패키징을 먼저 확인해 주세요.");
  const script = state.records.find((record) => record.id === plan.script?.id);
  const manuscript = typeof script?.metadata.manuscript === "string" ? script.metadata.manuscript : null;
  const markdown = myinScriptMarkdown(manuscript, scriptText);
  const { spoken } = myinCleanScript(markdown);
  if (!spoken.length) throw new ApiError(409, "MYIN_SCRIPT_EMPTY", "읽을 문단이 없는 원고입니다.");
  return { state, inputKey: plan.inputKey, script: plan.script, markdown, spoken };
}

async function save(service: Service, record: OsRecord, status: string, stage: string, run: MyinRun) {
  const { data, error } = await service.from("os_records").update({ status, stage, metadata: run, updated_by: record.owner_id })
    .eq("id", record.id).eq("version", record.version).eq("record_type", "ai_job").is("archived_at", null).select("*").maybeSingle();
  if (error || !data) throw new ApiError(409, "MYIN_RUN_CHANGED", "v13 작업이 먼저 변경됐습니다.");
  return data as OsRecord;
}

export function presentMyinRun(record: OsRecord) {
  const run = parse(record);
  return { id: record.id, status: record.status, stage: record.stage, paragraphs: run.paragraphs.length,
    paragraphsReady: run.paragraphs.filter((p) => p.status === "ready").length, words: run.words ?? null,
    storyboard: run.storyboard ? { ...run.storyboard, path: undefined } : null, review: run.review ?? null,
    assetDecisions: Object.fromEntries(Object.entries(run.assets ?? {}).map(([file, value]) => [file, { decision: value.decision, uploaded: Boolean(value.path) }])),
    ctaReady: run.cta ? `${run.cta.filter((c) => c.status === "ready").length}/${run.cta.length}` : null,
    prepared: run.prepared ? { misses: run.prepared.misses, sheets: run.prepared.sheets.length, credits: run.prepared.credits, at: run.prepared.at } : null,
    lastErrorCode: run.lastError?.code ?? null, createdAt: record.created_at };
}

/** The content owner's latest v13 run for one video, with the frozen transcription (words, speech) once it exists. */
export async function myinRunWithWords(service: Service, sourceId: string, ownerId: string) {
  const { data } = await service.from("os_records").select("*").eq("parent_id", sourceId).eq("record_type", "ai_job").eq("owner_id", ownerId)
    .eq("metadata->>kind", MYIN_RUN_KIND).is("archived_at", null).order("created_at", { ascending: false }).limit(1);
  const record = data?.[0] as OsRecord | undefined;
  if (!record) throw new ApiError(409, "MYIN_RUN_REQUIRED", "먼저 v13 음성과 받아쓰기·자막을 만들어 주세요.");
  const run = parse(record);
  if (!run.words) throw new ApiError(409, "MYIN_WORDS_NOT_READY", "받아쓰기·자막이 끝난 뒤에 기획표를 쓸 수 있습니다.");
  const { data: file } = await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).download(run.words.path);
  if (!file) throw new ApiError(409, "MYIN_BUNDLE_MISSING", "받아쓰기 결과 파일을 찾지 못했습니다.");
  const bundle = JSON.parse(await file.text()) as { words: [number, number, string][]; speech: string };
  const input = await currentInput(service, sourceId);
  return { record, run, words: bundle.words, markdown: input.markdown, title: input.state.writing.packageTitle || input.state.source.title };
}

/** A storyboard the OS checked goes to Logan: kept as a file, summarised for the ③ panel. */
export async function saveMyinStoryboard(service: Service, record: OsRecord, run: MyinRun, value: {
  storyboard: Record<string, unknown>; assets: NonNullable<MyinRun["storyboard"]>["assets"]; reasons: NonNullable<MyinRun["storyboard"]>["reasons"];
  fuzzy: string[]; notes: string[]; model: string;
}) {
  const path = `${record.owner_id}/${run.sourceId}/${record.id}/myin-storyboard.json`;
  const { error } = await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).upload(path, Buffer.from(JSON.stringify(value.storyboard)), { contentType: "application/json", upsert: true });
  if (error) throw new ApiError(502, "MYIN_STORYBOARD_UPLOAD_FAILED", "기획표를 저장하지 못했습니다.");
  const scenes = value.storyboard.scenes as { type: string; at?: string; title?: unknown; points?: { h?: string }[] }[];
  const metaphorTypes = new Set(MYIN_METAPHOR_TYPES);
  const summary = scenes.find((sc) => sc.type === "summary");
  const next: MyinRun = { ...run, storyboard: { path, scenes: scenes.length, model: value.model, at: new Date().toISOString(),
    metaphors: scenes.flatMap((sc, i) => metaphorTypes.has(sc.type) ? [{ scene: i + 1, type: sc.type, at: String(sc.at ?? "") }] : []),
    cta: (value.storyboard.cta as { after: string; line: string }[]).map(({ after, line }) => ({ after, line })),
    summary: summary ? { title: typeof summary.title === "string" ? summary.title : JSON.stringify(summary.title ?? ""), points: (summary.points ?? []).map((p) => String(p.h ?? "")) } : null,
    reasons: value.reasons, assets: value.assets, fuzzy: value.fuzzy.slice(0, 60), notes: value.notes } };
  delete next.review;
  return save(service, record, "backlog", "storyboard_review", next);
}

/** Logan (연출자) confirms the storyboard, or sends it back with a note for the staff AI's next pass. */
export async function reviewMyinStoryboard(actor: RequestActor, runId: string, decision: "confirmed" | "revise", note: string) {
  const service = createServiceSupabase();
  const { data } = await service.from("os_records").select("*").eq("id", runId).eq("record_type", "ai_job").is("archived_at", null).maybeSingle();
  if (!data) throw new ApiError(404, "MYIN_RUN_NOT_FOUND", "v13 작업을 찾지 못했습니다.");
  const record = data as OsRecord;
  const run = parse(record);
  if (record.stage !== "storyboard_review" || !run.storyboard) throw new ApiError(409, "MYIN_NOT_IN_REVIEW", "확인을 기다리는 기획표가 없습니다.");
  if (decision === "revise" && !note.trim()) throw new ApiError(400, "MYIN_REVIEW_NOTE_REQUIRED", "무엇을 고칠지 한 줄 적어 주세요.");
  const next: MyinRun = { ...run, review: { decision, by: actor.id, name: actor.name, note: note.trim().slice(0, 2000), at: new Date().toISOString() } };
  return presentMyinRun(await save(service, record, decision === "confirmed" ? "done" : "backlog", decision === "confirmed" ? "storyboard_confirmed" : "words_ready", next));
}

export async function latestMyinRun(actor: RequestActor, sourceId: string) {
  const { data } = await actor.supabase.from("os_records").select("*").eq("parent_id", sourceId).eq("record_type", "ai_job")
    .eq("owner_id", actor.id).eq("metadata->>kind", MYIN_RUN_KIND).is("archived_at", null).order("created_at", { ascending: false }).limit(1);
  return data?.[0] ? presentMyinRun(data[0] as OsRecord) : null;
}

/** [v13 음성 만들기]: the content owner (an admin, as for today's voice runs) starts one run for the approved script. */
export async function createMyinRun(actor: RequestActor, sourceId: string) {
  if (actor.role !== "admin") throw new ApiError(403, "ADMIN_REQUIRED", "관리자만 음성 제작을 시작할 수 있습니다.");
  const input = await currentInput(actor.supabase, sourceId);
  if (input.state.source.owner_id !== actor.id) throw new ApiError(403, "CONTENT_OWNER_REQUIRED", "이 콘텐츠의 담당자만 음성 제작을 시작할 수 있습니다.");
  const voiceReference = process.env.FISH_VOICE_REFERENCE_ID?.trim() ?? "";
  if (!process.env.FISH_API_KEY?.trim() || !voiceReference) throw new ApiError(503, "VOICE_WORKER_NOT_CONFIGURED", "Fish Audio 연결을 확인해 주세요.");
  const fingerprint = digestVoiceValue(voiceReference);
  const markdownHash = sha(input.markdown);
  const runKey = digestVoiceValue([MYIN_RUN_KIND, sourceId, input.inputKey, markdownHash, MYIN_VOICE_MODEL, fingerprint]);
  const id = voiceRunId(runKey);
  const run: MyinRun = { kind: MYIN_RUN_KIND, runKey, sourceId, inputKey: input.inputKey, script: input.script, scriptMarkdownHash: markdownHash,
    voiceModel: MYIN_VOICE_MODEL, voiceReferenceFingerprint: fingerprint, attempts: 0,
    paragraphs: input.spoken.map((text, index) => ({ index, textHash: sha(text), status: "pending" })) };
  const { data, error } = await actor.supabase.from("os_records").insert({
    id, record_type: "ai_job", title: `${input.state.source.title} · v13 음성·받아쓰기`.slice(0, 240),
    description: "승인된 원고로 마이인 v13 음성을 만들고 렌더 PC가 받아쓰기·자막을 만드는 작업입니다.", status: "backlog", stage: "voice_pending",
    priority: "normal", brand: input.state.source.brand, team: input.state.source.team, owner_id: actor.id, parent_id: sourceId,
    created_by: actor.id, updated_by: actor.id, tags: ["유튜브", "마이인v13"], metadata: run,
  }).select("*").maybeSingle();
  if (!error && data) return presentMyinRun(data as OsRecord);
  if (error?.code !== "23505") throw new ApiError(500, "MYIN_RUN_CREATE_FAILED", "v13 작업을 저장하지 못했습니다.");
  // Same script, same voice: the run already exists. A blocked one goes back in the queue with fresh attempts.
  const { data: existing } = await actor.supabase.from("os_records").select("*").eq("id", id).is("archived_at", null).maybeSingle();
  if (!existing) throw new ApiError(409, "MYIN_RUN_CONFLICT", "기존 v13 작업을 확인할 수 없습니다.");
  if (existing.status !== "blocked") return presentMyinRun(existing as OsRecord);
  const prior = parse(existing as OsRecord);
  const resumed: MyinRun = { ...prior, attempts: 0 }; delete resumed.lease;
  const stage = prior.paragraphs.every((p) => p.status === "ready") ? "words_pending" : "voice_pending";
  return presentMyinRun(await save(createServiceSupabase(), existing as OsRecord, "backlog", stage, resumed));
}

/** Drop a run whose script changed after it started; the owner starts a new one. */
async function assertCurrent(service: Service, run: MyinRun) {
  const input = await currentInput(service, run.sourceId);
  if (input.inputKey !== run.inputKey || sha(input.markdown) !== run.scriptMarkdownHash ||
    input.spoken.length !== run.paragraphs.length || input.spoken.some((text, i) => sha(text) !== run.paragraphs[i].textHash))
    throw new ApiError(409, "MYIN_RUN_STALE", "원고가 바뀌었습니다. v13 음성을 다시 시작해 주세요.");
  return input;
}

async function claim(service: Service, stage: string, leaseMs: number) {
  const { data } = await service.from("os_records").select("*").eq("record_type", "ai_job").eq("metadata->>kind", MYIN_RUN_KIND)
    .eq("stage", stage).in("status", ["backlog", "in_progress"]).is("archived_at", null).order("created_at").limit(10);
  for (const candidate of (data ?? []) as OsRecord[]) {
    let run: MyinRun; try { run = parse(candidate); } catch { continue; }
    if (run.lease && Date.parse(run.lease.expiresAt) > Date.now()) continue;
    if (run.attempts >= 3) { await save(service, candidate, "blocked", stage, run).catch(() => null); continue; }
    const lease = { token: randomUUID(), expiresAt: new Date(Date.now() + leaseMs).toISOString() };
    const claimed = await save(service, candidate, "in_progress", stage, { ...run, lease, attempts: run.attempts + 1 }).catch(() => null);
    if (claimed) return { record: claimed, run: parse(claimed), lease };
  }
  return null;
}

async function failed(service: Service, record: OsRecord, run: MyinRun, code: string) {
  const next: MyinRun = { ...run, lastError: { code: code.replace(/[^A-Z0-9_]/g, "").slice(0, 60) || "MYIN_FAILED", at: new Date().toISOString() } };
  delete next.lease;
  const final = code === "MYIN_RUN_STALE" || run.attempts >= 3;
  await save(service, record, final ? "blocked" : "backlog", record.stage ?? "voice_pending", next);
}

/** One paragraph of voice per call; the render PC's queue loop calls this when no older voice run is waiting. */
export async function processMyinVoiceStep(service: Service = createServiceSupabase()) {
  const claimed = await claim(service, "voice_pending", 240_000);
  if (!claimed) return processMyinCtaStep(service);
  const { record, run } = claimed;
  try {
    const input = await assertCurrent(service, run);
    const voiceReference = process.env.FISH_VOICE_REFERENCE_ID?.trim() ?? "";
    if (!process.env.FISH_API_KEY?.trim() || digestVoiceValue(voiceReference) !== run.voiceReferenceFingerprint)
      throw new ApiError(409, "MYIN_RUN_STALE", "목소리 설정이 바뀌었습니다. v13 음성을 다시 시작해 주세요.");
    const pending = run.paragraphs.find((p) => p.status === "pending");
    let paragraphs = run.paragraphs;
    if (pending) {
      const audio = await synthesizeFishWav(input.spoken[pending.index], { apiKey: process.env.FISH_API_KEY ?? "", referenceId: voiceReference, model: MYIN_VOICE_MODEL });
      const path = paragraphPath(record, run, pending.index);
      const { error } = await service.storage.from(YOUTUBE_VOICE_BUCKET).upload(path, new Uint8Array(audio.bytes), { contentType: audio.mimeType, upsert: true });
      if (error) throw new ApiError(502, "VOICE_STORAGE_UPLOAD_FAILED", "생성된 음성을 저장하지 못했습니다.");
      paragraphs = run.paragraphs.map((p) => p.index === pending.index ? { ...p, status: "ready" as const, path, bytes: audio.bytes.length } : p);
    }
    const done = paragraphs.every((p) => p.status === "ready");
    const next: MyinRun = { ...run, paragraphs, attempts: 0 }; delete next.lease; delete next.lastError;
    await save(service, record, "backlog", done ? "words_pending" : "voice_pending", next);
    return { processed: true, myinRunId: record.id, ready: paragraphs.filter((p) => p.status === "ready").length, of: paragraphs.length };
  } catch (error) {
    await failed(service, record, run, error instanceof ApiError ? error.code : "MYIN_VOICE_FAILED");
    return { processed: true, myinRunId: record.id, error: error instanceof ApiError ? error.code : "MYIN_VOICE_FAILED" };
  }
}

const bundlePath = (record: OsRecord, run: MyinRun) => `${record.owner_id}/${run.sourceId}/${record.id}/myin-words.json`;

/** Render PC: take a run whose voice is complete, with the script file, each paragraph's text and wav, and where to put the bundle. */
export async function claimMyinWords(service: Service = createServiceSupabase()) {
  const claimed = await claim(service, "words_pending", WORDS_LEASE_MS);
  if (!claimed) return { idle: true as const };
  const { record, run, lease } = claimed;
  try {
    const input = await assertCurrent(service, run);
    const paragraphs = [];
    for (const p of run.paragraphs) {
      const { data, error } = await service.storage.from(YOUTUBE_VOICE_BUCKET).createSignedUrl(p.path ?? "", 1_800);
      if (error || !data) throw new ApiError(503, "MYIN_SIGN_FAILED", "음성 파일 주소를 만들지 못했습니다.");
      paragraphs.push({ index: p.index, text: input.spoken[p.index], url: data.signedUrl });
    }
    const { data: upload, error } = await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).createSignedUploadUrl(bundlePath(record, run), { upsert: true });
    if (error || !upload) throw new ApiError(503, "MYIN_SIGN_FAILED", "결과 업로드 주소를 만들지 못했습니다.");
    return { runId: record.id, lease: lease.token, scriptMarkdown: input.markdown, paragraphs, bundleUploadUrl: upload.signedUrl };
  } catch (error) {
    await failed(service, record, run, error instanceof ApiError ? error.code : "MYIN_CLAIM_FAILED");
    throw error;
  }
}

async function leased(service: Service, runId: string, token: string) {
  const { data } = await service.from("os_records").select("*").eq("id", runId).eq("record_type", "ai_job").is("archived_at", null).maybeSingle();
  const run = data ? parse(data as OsRecord) : null;
  if (!data || !run || run.lease?.token !== token || Date.parse(run.lease.expiresAt) < Date.now())
    throw new ApiError(409, "MYIN_LEASE_LOST", "v13 작업의 처리 권한이 만료됐습니다.");
  return { record: data as OsRecord, run };
}

const bundleSchema = z.object({
  words: z.array(z.tuple([z.number(), z.number(), z.string()])).min(1),
  subtitlesAss: z.string().min(1), subtitleQc: z.string(), speech: z.string().min(1), durationSeconds: z.number().positive(),
}).passthrough();

/** Render PC: the bundle is up; the OS reads it back before the run moves on. */
export async function completeMyinWords(input: { runId: string; lease: string }, service: Service = createServiceSupabase()) {
  const { record, run } = await leased(service, input.runId, input.lease);
  const path = bundlePath(record, run);
  const { data, error } = await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).download(path);
  if (error || !data) throw new ApiError(409, "MYIN_BUNDLE_MISSING", "받아쓰기 결과 파일을 찾지 못했습니다.");
  const bundle = bundleSchema.safeParse(JSON.parse(await data.text()));
  if (!bundle.success) throw new ApiError(422, "MYIN_BUNDLE_INVALID", "받아쓰기 결과 형식이 맞지 않습니다.");
  const spoken = bundle.data.speech.replace(/\r/g, "").split("\n").filter((line) => line.trim() && !line.startsWith("#SECTION"));
  if (spoken.length !== run.paragraphs.length || spoken.some((text, i) => sha(text) !== run.paragraphs[i].textHash))
    throw new ApiError(422, "MYIN_PARAGRAPHS_MISMATCH", "렌더 PC가 읽은 문단이 OS 원고와 다릅니다.");
  const next: MyinRun = { ...run, attempts: 0, words: { path, words: bundle.data.words.length,
    subtitleLines: (bundle.data.subtitlesAss.match(/^Dialogue:/gm) ?? []).length, durationSeconds: bundle.data.durationSeconds, at: new Date().toISOString() } };
  delete next.lease; delete next.lastError;
  await save(service, record, "done", "words_ready", next);
  return { runId: record.id, stage: "words_ready" };
}

export async function failMyinWords(input: { runId: string; lease: string; code: string }, service: Service = createServiceSupabase()) {
  const { record, run } = await leased(service, input.runId, input.lease);
  await failed(service, record, run, input.code);
  return { runId: record.id, retry: run.attempts < 3 };
}

/** The subtitle check sheet and counts for the ③ panel. */
export async function myinWordsReport(actor: RequestActor, runId: string) {
  const { data: record } = await actor.supabase.from("os_records").select("*").eq("id", runId).eq("owner_id", actor.id).is("archived_at", null).maybeSingle();
  const run = record ? parse(record as OsRecord) : null;
  if (!run?.words) throw new ApiError(404, "MYIN_WORDS_NOT_READY", "받아쓰기·자막이 아직 없습니다.");
  const { data } = await createServiceSupabase().storage.from(YOUTUBE_VOICE_TIMING_BUCKET).download(run.words.path);
  if (!data) throw new ApiError(404, "MYIN_BUNDLE_MISSING", "받아쓰기 결과 파일을 찾지 못했습니다.");
  const bundle = JSON.parse(await data.text()) as { subtitleQc?: string };
  return { subtitleQc: String(bundle.subtitleQc ?? "").slice(0, 20_000) };
}

// ── Stage 3: photos, music, CTA voice and the render PC's preparation with Logan's preview check ──

const ASSET_BUCKET = "os-youtube-video"; // private, accepts audio/mpeg; uploaded music lives next to the video
const SHEET_BUCKET = "os-youtube-character"; // private, accepts PNG: Logan's preview sheets for the ③ panel
const md5 = (value: string) => createHash("md5").update(value).digest("hex");

async function runRecord(service: Service, runId: string) {
  const { data } = await service.from("os_records").select("*").eq("id", runId).eq("record_type", "ai_job").is("archived_at", null).maybeSingle();
  if (!data) throw new ApiError(404, "MYIN_RUN_NOT_FOUND", "v13 작업을 찾지 못했습니다.");
  const record = data as OsRecord;
  return { record, run: parse(record) };
}
async function ownedRun(actor: RequestActor, runId: string) {
  const found = await runRecord(createServiceSupabase(), runId);
  if (found.record.owner_id !== actor.id) throw new ApiError(403, "CONTENT_OWNER_REQUIRED", "이 콘텐츠의 담당자만 자료를 정할 수 있습니다.");
  return found;
}
async function storyboardJson(service: Service, run: MyinRun) {
  const { data } = await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).download(run.storyboard?.path ?? "");
  if (!data) throw new ApiError(409, "MYIN_STORYBOARD_MISSING", "기획표 파일을 찾지 못했습니다.");
  return JSON.parse(await data.text()) as Record<string, unknown> & { scenes: Record<string, unknown>[]; cta: { line: string }[] };
}

/** File names the storyboard points at: photo/music "file", opening "image", site_ad "capture" (made by the render PC). */
export function myinReferencedFiles(storyboard: unknown) {
  const files = new Set<string>();
  const walk = (o: unknown) => {
    if (Array.isArray(o)) o.forEach(walk);
    else if (o && typeof o === "object") for (const [k, v] of Object.entries(o)) {
      if ((k === "file" || k === "image") && typeof v === "string") files.add(v); else walk(v);
    }
  };
  walk(storyboard);
  return files;
}
const pageId = (url: string) => url.split("/photos/")[1]?.split(/[?#/]/)[0]?.split("-").pop() ?? "";
/** Where the render PC fetches an approved file: what a person uploaded, else the photo site's own download address. */
function fetchUrl(asset: { url: string }, uploaded: string | undefined) {
  if (uploaded) return { storage: uploaded };
  const url = new URL(asset.url);
  if (url.hostname === "unsplash.com" && pageId(asset.url)) return { url: `https://unsplash.com/photos/${pageId(asset.url)}/download?force=true` };
  if (url.hostname === "commons.wikimedia.org" && url.pathname.startsWith("/wiki/File:")) return { url: `https://commons.wikimedia.org/wiki/Special:FilePath/${url.pathname.slice("/wiki/File:".length)}` };
  return null; // Pixabay and others: a person downloads it and uploads the file here
}

/** [허락] / [빼기] on one candidate. */
export async function decideMyinAsset(actor: RequestActor, runId: string, file: string, decision: "approved" | "excluded") {
  const { record, run } = await ownedRun(actor, runId);
  if (!["storyboard_confirmed", "prep_ready"].includes(record.stage ?? "") || !run.storyboard?.assets.some((a) => a.file === file))
    throw new ApiError(409, "MYIN_ASSET_NOT_OPEN", "기획표가 확인된 뒤 후보 목록에 있는 파일만 정할 수 있습니다.");
  const prior = run.assets?.[file];
  const next: MyinRun = { ...run, assets: { ...run.assets, [file]: { ...(prior ?? {}), decision, by: actor.id, at: new Date().toISOString() } } };
  return presentMyinRun(await save(createServiceSupabase(), record, record.status ?? "done", record.stage ?? "storyboard_confirmed", next));
}

/** A signed address to upload one approved file a person downloaded (mp3 for music). */
export async function myinAssetUploadUrl(actor: RequestActor, runId: string, file: string) {
  const { record, run } = await ownedRun(actor, runId);
  if (run.assets?.[file]?.decision !== "approved") throw new ApiError(409, "MYIN_ASSET_NOT_APPROVED", "허락한 파일만 올릴 수 있습니다.");
  const path = `${record.owner_id}/${run.sourceId}/${record.id}/assets/${file}`;
  const { data, error } = await createServiceSupabase().storage.from(ASSET_BUCKET).createSignedUploadUrl(path, { upsert: true });
  if (error || !data) throw new ApiError(503, "MYIN_SIGN_FAILED", "업로드 주소를 만들지 못했습니다.");
  return { signedUrl: data.signedUrl, path };
}

/** After the browser's upload: the OS checks the file is there before counting it. */
export async function confirmMyinAssetUpload(actor: RequestActor, runId: string, file: string) {
  const { record, run } = await ownedRun(actor, runId);
  const path = `${record.owner_id}/${run.sourceId}/${record.id}/assets/${file}`;
  const folder = path.slice(0, path.lastIndexOf("/"));
  const { data } = await createServiceSupabase().storage.from(ASSET_BUCKET).list(folder, { search: file, limit: 5 });
  const object = data?.find((item) => item.name === file);
  if (!object || run.assets?.[file]?.decision !== "approved") throw new ApiError(409, "MYIN_ASSET_UPLOAD_MISSING", "올린 파일을 찾지 못했습니다. 다시 올려 주세요.");
  const bytes = Number((object.metadata as { size?: number } | null)?.size ?? 0) || undefined;
  const next: MyinRun = { ...run, assets: { ...run.assets, [file]: { ...run.assets[file], path, ...(bytes ? { bytes } : {}) } } };
  return presentMyinRun(await save(createServiceSupabase(), record, record.status ?? "done", record.stage ?? "storyboard_confirmed", next));
}

/** [자료 준비 시작]: every file the storyboard uses is approved and fetchable; the CTA lines go to Fish next. */
export async function startMyinPrep(actor: RequestActor, runId: string) {
  const service = createServiceSupabase();
  const { record, run } = await ownedRun(actor, runId);
  const restart = record.status === "blocked" && ["cta_pending", "prep_pending"].includes(record.stage ?? "");
  if ((!["storyboard_confirmed", "prep_ready"].includes(record.stage ?? "") && !restart) || !run.storyboard) throw new ApiError(409, "MYIN_PREP_NOT_OPEN", "기획표 확인이 끝난 뒤에 시작할 수 있습니다.");
  const story = await storyboardJson(service, run);
  const byFile = new Map(run.storyboard.assets.map((a) => [a.file, a]));
  const problems: string[] = [];
  for (const file of myinReferencedFiles(story)) {
    const asset = byFile.get(file);
    if (!asset) continue; // a package file (end screen) or the render PC's site capture
    const decision = run.assets?.[file];
    if (decision?.decision !== "approved") problems.push(`${file}: 기획표에 쓰였는데 아직 허락하지 않았습니다.`);
    else if (!fetchUrl(asset, decision.path)) problems.push(`${file}: 이 사이트는 자동으로 받을 수 없어 파일을 직접 올려야 합니다.`);
  }
  if (problems.length) throw new ApiError(409, "MYIN_PREP_ASSETS", problems.join(" / "));
  const cta: NonNullable<MyinRun["cta"]> = story.cta.map((c, index) => {
    const prior = run.cta?.find((p) => p.index === index && p.textHash === sha(c.line));
    return prior ?? { index, textHash: sha(c.line), status: "pending" as const };
  });
  const next: MyinRun = { ...run, cta, attempts: 0 }; delete next.prepared; delete next.lastError;
  return presentMyinRun(await save(service, record, "backlog", cta.every((c) => c.status === "ready") ? "prep_pending" : "cta_pending", next));
}

/** One CTA line of voice per call, the same Fish request as the paragraphs. */
async function processMyinCtaStep(service: Service) {
  const claimed = await claim(service, "cta_pending", 240_000);
  if (!claimed) return { processed: false };
  const { record, run } = claimed;
  try {
    const story = await storyboardJson(service, run);
    const pending = run.cta?.find((c) => c.status === "pending");
    let cta = run.cta ?? [];
    if (pending) {
      const line = story.cta[pending.index]?.line ?? "";
      if (sha(line) !== pending.textHash) throw new ApiError(409, "MYIN_RUN_STALE", "구독 대사가 바뀌었습니다. 자료 준비를 다시 시작해 주세요.");
      const audio = await synthesizeFishWav(line, { apiKey: process.env.FISH_API_KEY ?? "", referenceId: process.env.FISH_VOICE_REFERENCE_ID?.trim() ?? "", model: MYIN_VOICE_MODEL });
      const path = `${record.owner_id}/${run.sourceId}/${record.id}/cta_${String(pending.index).padStart(2, "0")}.wav`;
      const { error } = await service.storage.from(YOUTUBE_VOICE_BUCKET).upload(path, new Uint8Array(audio.bytes), { contentType: audio.mimeType, upsert: true });
      if (error) throw new ApiError(502, "VOICE_STORAGE_UPLOAD_FAILED", "구독 대사 음성을 저장하지 못했습니다.");
      cta = cta.map((c) => c.index === pending.index ? { ...c, status: "ready" as const, path } : c);
    }
    const next: MyinRun = { ...run, cta, attempts: 0 }; delete next.lease; delete next.lastError;
    await save(service, record, "backlog", cta.every((c) => c.status === "ready") ? "prep_pending" : "cta_pending", next);
    return { processed: true, myinRunId: record.id, cta: `${cta.filter((c) => c.status === "ready").length}/${cta.length}` };
  } catch (error) {
    await failed(service, record, run, error instanceof ApiError ? error.code : "MYIN_CTA_FAILED");
    return { processed: true, myinRunId: record.id, error: error instanceof ApiError ? error.code : "MYIN_CTA_FAILED" };
  }
}

const prepBundlePath = (record: OsRecord, run: MyinRun) => `${record.owner_id}/${run.sourceId}/${record.id}/myin-prep.json`;
const sheetPath = (record: OsRecord, run: MyinRun, n: number) => `${record.owner_id}/${run.sourceId}/${record.id}/preview_${String(n).padStart(2, "0")}.png`;
const sign = async (service: Service, bucket: string, path: string) => {
  const { data, error } = await service.storage.from(bucket).createSignedUrl(path, 1_800);
  if (error || !data) throw new ApiError(503, "MYIN_SIGN_FAILED", "파일 주소를 만들지 못했습니다.");
  return data.signedUrl;
};

/** Render PC: storyboard, approved files, CTA voice and where to put the preview sheets and the report. */
export async function claimMyinPrep(service: Service = createServiceSupabase()) {
  const claimed = await claim(service, "prep_pending", WORDS_LEASE_MS);
  if (!claimed) return { idle: true as const };
  const { record, run, lease } = claimed;
  try {
    const story = await storyboardJson(service, run);
    const assets = [];
    for (const asset of run.storyboard?.assets ?? []) {
      const decision = run.assets?.[asset.file];
      if (decision?.decision !== "approved") continue;
      const where = fetchUrl(asset, decision.path);
      if (!where) continue;
      assets.push({ kind: asset.kind, file: asset.file, url: "storage" in where ? await sign(service, ASSET_BUCKET, where.storage!) : where.url });
    }
    const cta = [];
    for (const c of run.cta ?? []) cta.push({ index: c.index, line: story.cta[c.index].line, tag: md5(story.cta[c.index].line).slice(0, 8), url: await sign(service, YOUTUBE_VOICE_BUCKET, c.path ?? "") });
    const sheets = Math.ceil(story.scenes.length / 12) + 1;
    const sheetUploads = [];
    for (let n = 1; n <= sheets; n++) {
      const { data } = await service.storage.from(SHEET_BUCKET).createSignedUploadUrl(sheetPath(record, run, n), { upsert: true });
      if (data) sheetUploads.push(data.signedUrl);
    }
    const { data: bundle } = await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).createSignedUploadUrl(prepBundlePath(record, run), { upsert: true });
    if (!bundle) throw new ApiError(503, "MYIN_SIGN_FAILED", "결과 업로드 주소를 만들지 못했습니다.");
    return { runId: record.id, lease: lease.token, storyboard: story, assets, cta, siteCapture: story.scenes.some((sc) => sc.type === "site_ad"),
      sheetUploadUrls: sheetUploads, bundleUploadUrl: bundle.signedUrl };
  } catch (error) {
    await failed(service, record, run, error instanceof ApiError ? error.code : "MYIN_PREP_CLAIM_FAILED");
    throw error;
  }
}

/** Render PC: the preview ran. Its "문구 못 찾음" lines decide whether the run may go on to the preview clips. */
export async function completeMyinPrep(input: { runId: string; lease: string }, service: Service = createServiceSupabase()) {
  const { record, run } = await leased(service, input.runId, input.lease);
  const { data } = await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).download(prepBundlePath(record, run));
  if (!data) throw new ApiError(409, "MYIN_BUNDLE_MISSING", "준비 결과 파일을 찾지 못했습니다.");
  const bundle = z.object({ misses: z.array(z.string()), sheets: z.number().int().min(0) }).passthrough().parse(JSON.parse(await data.text()));
  const credits = (run.storyboard?.assets ?? []).filter((a) => run.assets?.[a.file]?.decision === "approved").map((a) => `${a.file} — ${a.source} · ${a.license} · ${a.url}`);
  const next: MyinRun = { ...run, attempts: 0, prepared: { path: prepBundlePath(record, run), misses: bundle.misses.slice(0, 60),
    sheets: Array.from({ length: bundle.sheets }, (_, i) => sheetPath(record, run, i + 1)), credits, at: new Date().toISOString() } };
  delete next.lease; delete next.lastError;
  await save(service, record, "done", "prep_ready", next);
  return { runId: record.id, stage: "prep_ready", misses: bundle.misses.length };
}

export async function failMyinPrep(input: { runId: string; lease: string; code: string }, service: Service = createServiceSupabase()) {
  const { record, run } = await leased(service, input.runId, input.lease);
  await failed(service, record, run, input.code);
  return { runId: record.id, retry: run.attempts < 3 };
}

/** Logan's preview sheets for the ③ panel (10 minutes). */
export async function myinPreviewSheets(actor: RequestActor, runId: string) {
  const { run } = await ownedRun(actor, runId);
  const service = createServiceSupabase();
  return { sheets: await Promise.all((run.prepared?.sheets ?? []).map((path) => sign(service, SHEET_BUCKET, path))) };
}
