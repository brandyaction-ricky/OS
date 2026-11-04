import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { myinBreathText, myinCleanScript, myinRunMatchesScript, myinScriptMarkdown } from "@/lib/myin-script";
import { placeFilter } from "@/lib/myin-local";
import { changedMaterials, type MyinMaterials } from "@/lib/myin-materials";
import { planVoiceFix } from "@/lib/myin-voice-plan";
import { applySubtitleEdits, subtitleIssues, subtitleLines, subtitleTextProblem } from "@/lib/myin-subtitles";
import { applyMyinSoundPlan, MYIN_METAPHOR_TYPES, myinDriftPairs, myinOnlySoundChanged, myinPhotoFetchUrl, myinPhotoFolders, myinPrepPhotos, myinSceneStarts, myinSoundIssues, myinSoundPlan, myinStoryboardSchema, type MyinSoundPlan } from "@/lib/myin-storyboard";
import type { OsRecord } from "@/lib/record-types";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { RequestActor } from "./auth";
import { MYIN_VOICE_TUNING, synthesizeFishWav } from "./fish-audio";
import { readDiagramCatalog } from "./diagram-catalog";
import { readSoundCatalog } from "./sound-catalog";
import { readYoutubeAutomationInput } from "./youtube-automation-input";
import { renderPcEngine } from "./youtube-render-pc";
import { readChannelStyles } from "./youtube-channel-styles";
import { channelToneSchema, pinStyle } from "@/lib/youtube-process/channel-style";
import { assertSpokenScript } from "./youtube-script-canon";
import { digestVoiceValue, voiceRunId, YOUTUBE_VOICE_BUCKET, YOUTUBE_VOICE_TIMING_BUCKET } from "./youtube-voice-run";
import { readVoiceDictionary, reportVoiceDictionary } from "./youtube-voice-dictionary";
import { dictionaryFiles, type VoiceDictionaryFiles } from "@/lib/youtube-process/voice-dictionary";

// 마이인 v13 (owner decision 2026-10-19: the default format; design https://claude.ai/artifact/NCJ5qjYNeBYgfwjCnm1JgQ).
// One run per approved script. Stage 1: the render PC picks each paragraph's breath commas with Logan's model (breath_pending, 로건
// 호흡·타이밍 2026-10-27), the OS server asks Fish for each paragraph exactly as Logan's stage_voice.py does and
// keeps the wav (voice_pending); the render PC then runs his pipeline unchanged on those files — voice post-processing, words.json
// and subtitles — and sends back one JSON bundle (words_pending → words_ready). The voice is frozen from here: Fish never reads a
// line the same way twice, and every later cue is matched against this transcription.
// 로건 사람 말투 음성 (2026-10-29, 회사 청취 비교 2번, OS 문서 「AI 베이직 목소리 — 사람 말투로 교체」 A안): unless MYIN_VOICE_ON_RENDER_PC=0 a
// new run skips both steps above and goes straight to words_pending; his stage_voice on the render PC asks Fish sentence by sentence
// (two takes where the first one breaks, pitch and loudness matched) with the render PC's own key and the voice the OS sends.
export const MYIN_RUN_KIND = "youtube_myin_v13";
export const MYIN_VOICE_MODEL = "drama-3"; // pinned like Logan: Fish serves an unknown model name as 2.1 without an error
const WORDS_LEASE_MS = 30 * 60_000;
// One clip per metaphor scene takes about two minutes on the render PC; a stage-diagram video has 20+ (2026-10-25: 21 clips, 38 minutes).
// ponytail: fixed two hours covers ~50 clips; scale with the clip count if storyboards grow past that.
const CLIPS_LEASE_MS = 120 * 60_000;
// The full video: 52 minutes for a 13-minute longform at 30 fps (2026-10-28); Logan's engine renders it at 60 fps from 2026-10-29, about
// twice that. A result that lands after its lease is thrown away and rendered again, so the lease must outlast the render.
// ponytail: fixed four hours covers ~25-minute longforms; renew the lease from the render PC if they grow past that.
const FINAL_LEASE_MS = 240 * 60_000;
// 10 MB parts of 48 kHz mono 16-bit voice (≈96 KB/s): 18 hold about 31 minutes; longforms run 11–14. A longer voice is logged by the
// render PC and its drafts stay there.
export const MYIN_VOICE_PARTS = 18;
// On by default once merged (the render PC is switched first: patched packages, its Fish key, the new worker); "0" turns it off.
export const myinVoiceOnRenderPc = () => process.env.MYIN_VOICE_ON_RENDER_PC !== "0";
type Service = ReturnType<typeof createServiceSupabase>;

const hex = z.string().regex(/^[a-f0-9]{64}$/);
// 엔진 버전 (보완 요청 4/8): the fingerprint of the v13 engine that drew a result, as the render PC reported it when the job was taken.
const engineFp = z.string().regex(/^[a-f0-9]{16,64}$/);
const versionRef = z.object({ id: z.string().uuid(), version: z.number().int().positive() }).strict();
// 재료 고정 (유쓰 요청 3/8 보완, 2026-11-03): the versions a result was made from — the voice with its words, the storyboard, ④'s sound
// edits, the subtitle edits, our images and the channel style. Each result keeps them, so the 제작 기록 can say which results the
// current materials no longer match; a job's result is taken only if they did not change while it ran.
const materialsSchema = z.object({ voice: z.string(), storyboard: z.string(), sound: z.string(), subtitles: z.string(), ours: z.string(), style: z.string() }).strict();
// 영상 편집기 확정 (로건 개발 문서 v2): a final confirmed from a member's editor — who, on which computer, from which of its versions, the
// engine it was drawn with, where its 5-second pieces start (frames, to split it again on another computer), the material bundle's
// parts and the orders it answers. Its materials live in that bundle, not in this run.
export const editFinalSchema = z.object({ id: z.string().uuid(), by: z.string().uuid(), name: z.string(), pc: z.string(), fromVersion: z.string(), note: z.string(),
  engine: z.string().regex(/^[a-f0-9]{32}$/), bounds: z.array(z.number().int().positive()).max(2000),
  parts: z.array(z.object({ bytes: z.number().int().positive(), sha256: hex }).strict()).min(1).max(24), orders: z.array(z.string().uuid()).max(200),
  check: z.object({ decodeErrors: z.number().int().min(0), frames: z.number().int().positive(), end: z.number().positive(), videoSeconds: z.number().positive(), audioSeconds: z.number().positive() }).strict() }).strict();
const finalSchema = z.object({ video: z.string(), summary: z.string().optional(), deck: z.string().optional(), srt: z.string(), bytes: z.number().int().positive(),
  durationSeconds: z.number().positive(), lufs: z.number(), peak: z.number(), at: z.string().datetime(),
  /** Which subtitle edits it was made with (자막 한꺼번에 고치기); none = the subtitles as stage 1 made them. */
  subtitles: hex.optional(), used: materialsSchema.optional(), engine: engineFp.optional(), edit: editFinalSchema.optional() }).strict();
// input: what the job was handed (the materials key; before 2026-11-03 a preparation's our images) — a result made from other input is
// not taken (유쓰 요청 2/8 · 3/8). stage: the stage it was claimed at; a run that moved on (수정 요청, a new start) takes no late result.
const leaseSchema = z.object({ token: z.string().uuid(), expiresAt: z.string().datetime(), startedAt: z.string().datetime().optional(), input: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  stage: z.string().max(40).optional(), engine: engineFp.optional() }).strict();
const runSchema = z.object({
  kind: z.literal(MYIN_RUN_KIND), runKey: hex, sourceId: z.string().uuid(), inputKey: hex, script: versionRef, scriptMarkdownHash: hex,
  // 숏폼 (2026-10-28): drawn 9:16 by the render PC's vertical copy of Logan's engine (MYIN_PKG_SHORT); no handouts, no staff-Mac drafts.
  layout: z.literal("short").optional(),
  // 로건 사람 말투 음성 (2026-10-29): the render PC makes the voice itself, so the paragraphs never get OS files.
  voiceOn: z.literal("render_pc").optional(),
  voiceModel: z.literal(MYIN_VOICE_MODEL), voiceReferenceFingerprint: hex,
  // 채널 모양 (유쓰 요청 5/8): the style picked when the voice started, with its version — a later change to the 틀 never reaches this video.
  style: z.object({ id: z.string().uuid(), name: z.string(), version: z.number().int().positive(), channel: z.string(), tone: channelToneSchema.nullable(),
    ending: z.enum(["talk", "outro"]), logo: z.boolean() }).strict().optional(),
  paragraphs: z.array(z.object({ index: z.number().int().min(0), textHash: hex, status: z.enum(["pending", "ready"]), path: z.string().optional(), bytes: z.number().int().positive().optional(),
    breath: z.array(z.number().int().min(0)).max(80).optional() }).strict()).min(1).max(150),
  words: z.object({ path: z.string(), words: z.number().int().positive(), subtitleLines: z.number().int().min(0), durationSeconds: z.number().positive(), at: z.string().datetime(),
    // 내 컴퓨터로 시안: his processed voice.wav as the render PC made it, in parts (the voice bucket takes 12 MB a file).
    voice: z.object({ path: z.string(), parts: z.number().int().min(1).max(MYIN_VOICE_PARTS), bytes: z.number().int().positive(), sha256: hex }).strict().optional(),
    // 음성 확인 (로건 OS 요청 2026-10-30): a small MP3 of the same voice to listen to on stage 1 (the WAV is ~75 MB for 13 minutes).
    preview: z.object({ path: z.string(), bytes: z.number().int().positive() }).strict().optional() }).strict().optional(),
  // 음성 확인·수정 (로건 OS 요청 2026-10-30): memos left on stage 1 wait here for the render PC, which redoes only those sentences with his
  // voice_fix (two new takes, the better one swapped in, the sentence added to his dictionary) and transcribes again; the check itself
  // (or skipping it) is recorded and never blocks stage 2.
  voiceFixes: z.array(z.object({ memo: z.string().min(1).max(300), say: z.string().max(300).optional(), read: z.string().max(100).optional(),
    video: z.literal(true).optional(), by: z.string().uuid(), name: z.string(), at: z.string().datetime() }).strict()).max(20).optional(),
  // 최종 검토 음성 피드백 (phase ③): a fix asked after the full video goes back to ④ when done, and says the voice changed until the
  // full video is made again.
  voiceResume: z.literal("prep_ready").optional(),
  voiceChanged: z.object({ at: z.string().datetime(), count: z.number().int().min(0) }).strict().optional(),
  voiceCheck: z.object({ skipped: z.boolean(), by: z.string().uuid(), name: z.string(), at: z.string().datetime() }).strict().optional(),
  // Stage 2: the staff AI's storyboard (kept in the voice-timing bucket) and what Logan sees to confirm it.
  storyboard: z.object({ path: z.string(), scenes: z.number().int().positive(), model: z.string(), at: z.string().datetime(),
    metaphors: z.array(z.object({ scene: z.number().int(), type: z.string(), at: z.string() }).strict()),
    cta: z.array(z.object({ after: z.string(), line: z.string() }).strict()),
    summary: z.object({ title: z.string(), points: z.array(z.string()) }).strict().nullable(),
    reasons: z.object({ metaphors: z.string(), cta: z.string(), summary: z.string() }).strict(),
    assets: z.array(z.object({ kind: z.enum(["people", "situations", "bgm"]), file: z.string(), url: z.string(), source: z.string(), license: z.string(), use: z.string() }).strict()),
    fuzzy: z.array(z.string()), notes: z.array(z.string()) }).strict().optional(),
  review: z.object({ decision: z.enum(["confirmed", "revise"]), by: z.string().uuid(), name: z.string(), note: z.string(), at: z.string().datetime() }).strict().optional(),
  // Stage 3: the photos approved with the storyboard (by file name), the CTA lines' voice, and the render PC's preparation
  // with Logan's preview check. Music comes from the 음악 창고 on the render PC (owner decision 2026-10-19).
  assets: z.record(z.string(), z.object({ decision: z.enum(["approved", "excluded"]), by: z.string().uuid(), at: z.string().datetime(),
    path: z.string().optional(), bytes: z.number().int().positive().optional() }).strict()).optional(),
  // 우리 이미지 (2026-10-28 대표 · 로건): a photo file the storyboard names, uploaded by staff (a workbook capture, a portrait the person
  // gave us). It goes to the PC that prepares in place of a listed photo of that name; uploading it is the approval.
  // credit (사진 후보, 2026-11-03): a candidate photo kept as ours, with the Unsplash · 위키미디어 credit it needs in the description.
  ours: z.record(z.string(), z.object({ path: z.string(), bytes: z.number().int().positive(), by: z.string().uuid(), name: z.string(), at: z.string().datetime(),
    credit: z.object({ source: z.string().max(300), license: z.string().max(120), url: z.string().url().max(600) }).strict().optional() }).strict()).optional(),
  // `pc`: a line the render PC made with Logan's stage_cta for a member's own computer (a finished file, used as it is).
  cta: z.array(z.object({ index: z.number().int().min(0), textHash: hex, status: z.enum(["pending", "ready"]), path: z.string().optional(), pc: z.literal(true).optional() }).strict()).optional(),
  prepared: z.object({ path: z.string(), misses: z.array(z.string()), sheets: z.array(z.string()), credits: z.array(z.string()), at: z.string().datetime(), used: materialsSchema.optional(), engine: engineFp.optional() }).strict().optional(),
  // Stage 4: Logan's 720p clips (opening + reel, each metaphor), his OK, then the full render, mix and handouts.
  clips: z.object({ items: z.array(z.object({ name: z.string(), label: z.string(), path: z.string() }).strict()), at: z.string().datetime(), used: materialsSchema.optional(),
    engine: engineFp.optional() }).strict().optional(),
  clipsReview: z.object({ by: z.string().uuid(), name: z.string(), note: z.string(), at: z.string().datetime() }).strict().optional(),
  // 내 컴퓨터로 시안 (owner decision 2026-10-27): ③'s preparation and clips run on this member's own Mac (same engine as the render
  // PC, checked by fingerprint) instead of the render PC.
  local: z.object({ by: z.string().uuid(), name: z.string(), at: z.string().datetime() }).strict().optional(),
  // 직원 요청 2026-11-03: ④ 자료 준비 and the full video on a member's own computer too — both, since the video is drawn from the folder
  // the preparation filled. The render PC still makes the 구독 대사 voice (the Fish key and Logan's voice tools live only there).
  localFinish: z.object({ by: z.string().uuid(), name: z.string(), at: z.string().datetime() }).strict().optional(),
  // 사운드 창고 (2026-10-27): Logan's music match report from the ③ preparation, and who last changed the sound at ④.
  sound: z.object({ report: z.string().max(20_000), at: z.string().datetime(),
    edited: z.object({ by: z.string().uuid(), name: z.string(), at: z.string().datetime() }).strict().optional() }).strict().optional(),
  // 자막 한꺼번에 고치기 (유쓰 요청 1/8): the words changed on stage 1's subtitle lines (by number, with the words they replaced).
  subtitleEdits: z.object({ lines: z.array(z.object({ i: z.number().int().min(0), from: z.string().max(400), to: z.string().min(1).max(80) }).strict()).max(600),
    at: z.string().datetime(), by: z.string().uuid(), name: z.string() }).strict().optional(),
  final: finalSchema.optional(),
  // 완성본 후보 (유쓰 요청 2/8 · 공통 조건, 2026-11-02): the finished videos made before the current one, oldest first. Making the video
  // again never drops one — each stays a version to compare, and its files stay where the render PC put them.
  finals: z.array(finalSchema).max(8).optional(),
  lease: leaseSchema.optional(), attempts: z.number().int().min(0).max(20),
  lastError: z.object({ code: z.string(), at: z.string().datetime(), files: z.array(z.string().max(200)).max(30).optional() }).strict().optional(),
}).strict();
type MyinRun = z.infer<typeof runSchema>;

const sha = (value: string) => createHash("sha256").update(value).digest("hex");
/** The current finished video joins the run's earlier ones instead of being dropped when the video is made again. */
function retireFinal(run: MyinRun) {
  if (!run.final) return;
  run.finals = [...(run.finals ?? []), run.final].slice(-8);
  delete run.final;
}
const parse = (record: Pick<OsRecord, "metadata">) => {
  // The 10-28 voice backfill also stored its request's "action" in words.voice (fixed 2026-10-29); reading leaves it out, so those
  // runs open again and their next save writes them clean.
  const metadata = record.metadata as Record<string, unknown> & { words?: { voice?: Record<string, unknown> } };
  const voice = metadata?.words?.voice;
  const stored = voice && "action" in voice ? { ...metadata, words: { ...metadata.words, voice: Object.fromEntries(Object.entries(voice).filter(([key]) => key !== "action")) } } : metadata;
  const result = runSchema.safeParse(stored);
  if (!result.success) throw new ApiError(409, "MYIN_RUN_INVALID", "저장된 v13 작업을 읽을 수 없습니다.");
  return result.data;
};
const paragraphPath = (record: OsRecord, run: MyinRun, index: number) => `${record.owner_id}/${run.sourceId}/${record.id}/p${String(index).padStart(2, "0")}.wav`;

/** The approved script as Logan's pipeline reads it, and the paragraphs his stage_voice speaks. */
async function currentInput(supabase: Service | RequestActor["supabase"], sourceId: string) {
  const input = await readYoutubeAutomationInput(supabase, sourceId);
  const { state, plan, scriptText, title } = input;
  // 숏폼: the head copy and the 대본 with its [관계] · [사람] screen hints go to the storyboard card.
  const { layout, headCopy = "", screenScript = "" } = input as { layout?: "short"; headCopy?: string; screenScript?: string };
  if (!plan.inputKey || !plan.script || !scriptText) throw new ApiError(409, "AUTOMATION_INPUT_CHANGED", "승인된 원고와 패키징을 먼저 확인해 주세요.");
  const script = state.records.find((record) => record.id === plan.script?.id);
  const manuscript = typeof script?.metadata.manuscript === "string" ? script.metadata.manuscript : null;
  const markdown = myinScriptMarkdown(manuscript, scriptText);
  const { spoken } = myinCleanScript(markdown);
  if (!spoken.length) throw new ApiError(409, "MYIN_SCRIPT_EMPTY", "읽을 문단이 없는 원고입니다.");
  return { state, inputKey: plan.inputKey, script: plan.script, markdown, spoken, title, layout, headCopy, screenScript };
}

async function save(service: Service, record: OsRecord, status: string, stage: string, run: MyinRun) {
  const { data, error } = await service.from("os_records").update({ status, stage, metadata: run, updated_by: record.owner_id })
    .eq("id", record.id).eq("version", record.version).eq("record_type", "ai_job").is("archived_at", null).select("*").maybeSingle();
  if (error || !data) throw new ApiError(409, "MYIN_RUN_CHANGED", "v13 작업이 먼저 변경됐습니다.");
  return data as OsRecord;
}

export function presentMyinRun(record: OsRecord) {
  const run = parse(record);
  return { id: record.id, status: record.status, stage: record.stage, layout: run.layout ?? null, paragraphs: run.paragraphs.length,
    paragraphsReady: run.paragraphs.filter((p) => p.status === "ready").length, voiceOnPc: Boolean(run.voiceOn), words: run.words ?? null,
    storyboard: run.storyboard ? { ...run.storyboard, path: undefined } : null, review: run.review ?? null,
    assetDecisions: Object.fromEntries(Object.entries(run.assets ?? {}).map(([file, value]) => [file, { decision: value.decision }])),
    ctaReady: run.cta ? `${run.cta.filter((c) => c.status === "ready").length}/${run.cta.length}` : null,
    prepared: run.prepared ? { misses: run.prepared.misses, sheets: run.prepared.sheets.length, credits: run.prepared.credits, at: run.prepared.at } : null,
    clips: run.clips ? run.clips.items.map(({ name, label }) => ({ name, label })) : null, clipsReview: run.clipsReview ?? null, sound: run.sound ?? null,
    final: run.final ? { bytes: run.final.bytes, durationSeconds: run.final.durationSeconds, lufs: run.final.lufs, peak: run.final.peak, at: run.final.at } : null,
    voiceFixes: (run.voiceFixes ?? []).map(({ memo, say, read, name }) => ({ memo, say: say ?? null, read: read ?? null, name })), voiceCheck: run.voiceCheck ?? null,
    voiceFixable: voiceFixable(record, run), voiceChanged: run.voiceChanged ?? null, subtitleEdits: run.subtitleEdits ? run.subtitleEdits.lines.length : 0,
    style: run.style ? { id: run.style.id, name: run.style.name, version: run.style.version, channel: run.style.channel } : null,
    lastErrorCode: run.lastError?.code ?? null, waitingPhotos: (run.lastError?.files ?? []).filter((file) => !run.ours?.[file]), createdAt: record.created_at, local: run.local ? { by: run.local.by, name: run.local.name } : null,
    localFinish: run.localFinish ? { by: run.localFinish.by, name: run.localFinish.name } : null, clipsStale: previewStale(run),
    photoCredits: Object.fromEntries(Object.entries(run.ours ?? {}).map(([file, image]) => [file, image.credit ? { source: image.credit.source, license: image.credit.license, url: image.credit.url }
      : { source: `우리 이미지 · ${image.name}`, license: "", url: null }])), localReady: Boolean(run.words?.voice) && !run.layout,
    // 로건 피드백 10/26-8: when the render PC took this step, so the screen can say how long it has been working.
    workingSince: record.status === "in_progress" ? run.lease?.startedAt ?? null : null };
}

/**
 * The latest v13 run for one video, with the frozen transcription (words, speech) once it exists. An admin starts the run (Fish
 * cost) and the content owner's AI writes its storyboard, so the run is found by video, not by who started it.
 */
export async function myinRunWithWords(service: Service, sourceId: string) {
  const { data } = await service.from("os_records").select("*").eq("parent_id", sourceId).eq("record_type", "ai_job")
    .eq("metadata->>kind", MYIN_RUN_KIND).is("archived_at", null).order("created_at", { ascending: false }).limit(1);
  const record = data?.[0] as OsRecord | undefined;
  if (!record) throw new ApiError(409, "MYIN_RUN_REQUIRED", "먼저 v13 음성과 받아쓰기·자막을 만들어 주세요.");
  const run = parse(record);
  if (!run.words) throw new ApiError(409, "MYIN_WORDS_NOT_READY", "받아쓰기·자막이 끝난 뒤에 기획표를 쓸 수 있습니다.");
  const { data: file } = await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).download(run.words.path);
  if (!file) throw new ApiError(409, "MYIN_BUNDLE_MISSING", "받아쓰기 결과 파일을 찾지 못했습니다.");
  const bundle = JSON.parse(await file.text()) as { words: [number, number, string][]; speech: string };
  const input = await currentInput(service, sourceId);
  return { record, run, words: bundle.words, speech: bundle.speech ?? "", markdown: input.markdown, title: input.title, headCopy: input.headCopy, screenScript: input.screenScript };
}

/** A storyboard the OS checked goes to Logan: kept as a file, summarised for the ③ panel. */
export async function saveMyinStoryboard(service: Service, record: OsRecord, run: MyinRun, value: {
  storyboard: Record<string, unknown>; assets: NonNullable<MyinRun["storyboard"]>["assets"]; reasons: NonNullable<MyinRun["storyboard"]>["reasons"];
  fuzzy: string[]; notes: string[]; model: string;
}) {
  const path = `${record.owner_id}/${run.sourceId}/${record.id}/myin-storyboard-${Date.now().toString(36)}.json`;
  const { error } = await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).upload(path, Buffer.from(JSON.stringify(value.storyboard)), { contentType: "application/json", upsert: true });
  if (error) throw new ApiError(502, "MYIN_STORYBOARD_UPLOAD_FAILED", "기획표를 저장하지 못했습니다.");
  const scenes = value.storyboard.scenes as { type: string; at?: string; title?: unknown; points?: { h?: string }[] }[];
  const metaphorTypes = new Set(MYIN_METAPHOR_TYPES);
  const summary = scenes.find((sc) => sc.type === "summary");
  const next: MyinRun = { ...run, storyboard: { path, scenes: scenes.length, model: value.model, at: new Date().toISOString(),
    metaphors: scenes.flatMap((sc, i) => metaphorTypes.has(sc.type) || sc.type.startsWith("lib_") ? [{ scene: i + 1, type: sc.type, at: String(sc.at ?? "") }] : []),
    cta: (value.storyboard.cta as { after: string; line: string }[]).map(({ after, line }) => ({ after, line })),
    summary: summary ? { title: typeof summary.title === "string" ? summary.title : JSON.stringify(summary.title ?? ""), points: (summary.points ?? []).map((p) => String(p.h ?? "")) } : null,
    reasons: value.reasons, assets: value.assets, fuzzy: value.fuzzy.slice(0, 60), notes: value.notes } };
  delete next.review;
  return save(service, record, "backlog", "storyboard_review", next);
}

/** Logan (연출자) confirms the storyboard, or sends it back with a note for the staff AI's next pass. */
export async function reviewMyinStoryboard(actor: RequestActor, runId: string, decision: "confirmed" | "revise", note: string, place: "pc" | "local" = "pc") {
  const service = createServiceSupabase();
  const { record, run } = await visibleRun(actor, runId);
  // Confirm from review; a change of mind (revise) is still possible after confirming, until the preview clips start.
  const open = decision === "confirmed" ? ["storyboard_review"] : ["storyboard_review", "storyboard_confirmed", "cta_pending", "prep_pending", "prep_ready", "clips_pending", "clips_review"];
  if (!open.includes(record.stage ?? "") || !run.storyboard) throw new ApiError(409, "MYIN_NOT_IN_REVIEW", "확인을 기다리는 기획표가 없습니다.");
  if (decision === "revise" && !note.trim()) throw new ApiError(400, "MYIN_REVIEW_NOTE_REQUIRED", "무엇을 고칠지 한 줄 적어 주세요.");
  if (decision === "confirmed") await assertCurrent(service, run);
  const next: MyinRun = { ...run, review: { decision, by: actor.id, name: actor.name, note: note.trim().slice(0, 2000), at: new Date().toISOString() } };
  if (decision === "confirmed") draftPlace(next, actor, place);
  if (decision === "revise") { delete next.prepared; delete next.clips; delete next.clipsReview; delete next.sound; delete next.lease; return presentMyinRun(await save(service, record, "backlog", "words_ready", next)); }
  // 2026-10-27 대표: 시안(도식·글자)을 먼저 본다. 사진 허락과 구독 대사 음성은 시안 확인 뒤 ④ 자료 준비에서(2026-10-19의 「확인 = 사진 허락」을 옮김).
  const saved = await save(service, record, "done", "storyboard_confirmed", next);
  return presentMyinRun(await beginDraft(service, saved, parse(saved)));
}

/** ③ drafts go to `local`, ④ with the full video (once the drafts are confirmed) to `localFinish`. */
function draftPlace(run: MyinRun, actor: RequestActor, place: "pc" | "local") {
  const field = run.clipsReview ? "localFinish" : "local";
  if (place === "local") { assertLocalReady(run); run[field] = { by: actor.ownerId, name: actor.name, at: new Date().toISOString() }; }
  else delete run[field];
}

/**
 * [영상 만드는 컴퓨터로 보내기] · [내 컴퓨터로 만들기]: move ③'s waiting drafts, or ④ (2026-11-03) — which prepares again at the new
 * place, since the full video is drawn from the folder its preparation filled. A step one machine is working on keeps going there; a
 * lease the staff computer let lapse (closed lid, quit) frees the step, so the other place can take it over.
 */
export async function setMyinDraftPlace(actor: RequestActor, runId: string, place: "pc" | "local") {
  const service = createServiceSupabase();
  const { record, run } = await visibleRun(actor, runId);
  const open = run.clipsReview ? ["cta_pending", "prep_pending", "prep_ready", "final_pending"] : ["prep_pending", "clips_pending"];
  if (!open.includes(record.stage ?? ""))
    throw new ApiError(409, "MYIN_PLACE_NOT_OPEN", run.clipsReview ? "전체 영상을 만들기 전에만 만들 곳을 바꿀 수 있어요." : "미리보기를 기다리는 동안에만 만들 곳을 바꿀 수 있어요.");
  if (run.lease && Date.parse(run.lease.expiresAt) > Date.now()) throw new ApiError(409, "MYIN_PLACE_BUSY", "지금 만드는 중이에요. 끝난 뒤에 바꿔 주세요.");
  if (run.clipsReview) await assertCurrent(service, run);
  const next: MyinRun = { ...run, attempts: 0 };
  delete next.lease; delete next.lastError;
  draftPlace(next, actor, place);
  if (run.clipsReview) return presentMyinRun(await beginPrep(service, record, next, actor.id));
  return presentMyinRun(await save(service, record, "backlog", record.stage!, next));
}

/** Everyone who can read the video sees its run: 로건 and 유쓰 confirm from their own accounts (RLS decides who reads). */
export async function latestMyinRun(actor: RequestActor, sourceId: string) {
  const { data } = await actor.supabase.from("os_records").select("*").eq("parent_id", sourceId).eq("record_type", "ai_job")
    .eq("metadata->>kind", MYIN_RUN_KIND).is("archived_at", null).order("created_at", { ascending: false }).limit(1);
  const record = data?.[0] as OsRecord | undefined;
  return record ? { ...presentMyinRun(record), scriptChanged: await scriptChanged(actor.supabase, parse(record)) } : null;
}

/** [v13 음성 만들기]: any member who can read the video starts its one run for the approved script (owner decision 2026-10-20: no extra roles). */
export async function createMyinRun(actor: RequestActor, sourceId: string, styleId?: string) {
  const input = await currentInput(actor.supabase, sourceId);
  const picked = styleId ? (await readChannelStyles()).styles.find((style) => style.id === styleId) : undefined;
  if (styleId && !picked) throw new ApiError(400, "CHANNEL_STYLE_NOT_FOUND", "고른 채널 모양을 찾지 못했어요. 새로 불러와 주세요.");
  // A 원고 edited after 제작 started reaches the voice here. ponytail: length is left to the 구성안 → 제작 check (no runtime here).
  // A 숏폼's 대본 passed its own check (숏폼 대본 정본 §10) at 대본 확정 and cannot change after it.
  if (!input.layout) await assertSpokenScript(actor.supabase, input.markdown, null);
  const voiceReference = process.env.FISH_VOICE_REFERENCE_ID?.trim() ?? "";
  if (!process.env.FISH_API_KEY?.trim() || !voiceReference) throw new ApiError(503, "VOICE_WORKER_NOT_CONFIGURED", "Fish Audio 연결을 확인해 주세요.");
  const fingerprint = digestVoiceValue(voiceReference);
  const markdownHash = sha(input.markdown);
  // The way the voice is made is part of the run: the same script voiced on the render PC is a new run (new voice), not the old one.
  const onPc = myinVoiceOnRenderPc();
  const runKey = digestVoiceValue([MYIN_RUN_KIND, sourceId, input.inputKey, markdownHash, MYIN_VOICE_MODEL, fingerprint, JSON.stringify(MYIN_VOICE_TUNING), ...(onPc ? ["render_pc"] : [])]);
  const id = voiceRunId(runKey);
  const run: MyinRun = { kind: MYIN_RUN_KIND, runKey, sourceId, inputKey: input.inputKey, script: input.script, scriptMarkdownHash: markdownHash,
    voiceModel: MYIN_VOICE_MODEL, voiceReferenceFingerprint: fingerprint, attempts: 0, ...(input.layout ? { layout: input.layout } : {}), ...(onPc ? { voiceOn: "render_pc" as const } : {}),
    ...(picked ? { style: pinStyle(picked) } : {}),
    paragraphs: input.spoken.map((text, index) => ({ index, textHash: sha(text), status: "pending" })) };
  const { data, error } = await actor.supabase.from("os_records").insert({
    id, record_type: "ai_job", title: `${input.state.source.title} · ${input.layout ? "숏폼 " : ""}v13 음성·받아쓰기`.slice(0, 240),
    description: "승인된 원고로 마이인 v13 음성을 만들고 렌더 PC가 받아쓰기·자막을 만드는 작업입니다.", status: "backlog", stage: onPc ? "words_pending" : "breath_pending",
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
  const stage = prior.voiceOn || prior.paragraphs.every((p) => p.status === "ready") ? "words_pending"
    : prior.paragraphs.some((p) => p.status === "pending" && !p.breath) ? "breath_pending" : "voice_pending";
  return presentMyinRun(await save(createServiceSupabase(), existing as OsRecord, "backlog", stage, resumed));
}

/** Drop a run whose script changed after it started; the owner starts a new one. */
async function assertCurrent(supabase: Service | RequestActor["supabase"], run: MyinRun) {
  const input = await currentInput(supabase, run.sourceId);
  if (!myinRunMatchesScript(run, { inputKey: input.inputKey, markdownHash: sha(input.markdown), spokenHashes: input.spoken.map(sha) }))
    throw new ApiError(409, "MYIN_RUN_STALE", "원고가 바뀌었습니다. v13 음성을 다시 시작해 주세요.");
  return input;
}

/** The ③ panel offers a new run once the 원고 was edited under this one; outside 제작 (no input to compare) it does not. */
async function scriptChanged(supabase: RequestActor["supabase"], run: MyinRun) {
  try { await assertCurrent(supabase, run); return false; }
  catch (error) { return error instanceof ApiError && error.code === "MYIN_RUN_STALE"; }
}

async function claim(service: Service, stage: string, leaseMs: number, accept: (run: MyinRun) => boolean = () => true, input?: (run: MyinRun) => string,
  engineOf?: (run: MyinRun) => Promise<string | undefined>) {
  const { data } = await service.from("os_records").select("*").eq("record_type", "ai_job").eq("metadata->>kind", MYIN_RUN_KIND)
    .eq("stage", stage).in("status", ["backlog", "in_progress"]).is("archived_at", null).order("created_at").limit(10);
  for (const candidate of (data ?? []) as OsRecord[]) {
    let run: MyinRun; try { run = parse(candidate); } catch { continue; }
    if (!accept(run)) continue;
    if (run.lease && Date.parse(run.lease.expiresAt) > Date.now()) continue;
    if (run.attempts >= 3) { await save(service, candidate, "blocked", stage, run).catch(() => null); continue; }
    const engine = await engineOf?.(run);
    const lease = { token: randomUUID(), expiresAt: new Date(Date.now() + leaseMs).toISOString(), startedAt: new Date().toISOString(), stage, ...(input ? { input: input(run) } : {}), ...(engine ? { engine } : {}) };
    const claimed = await save(service, candidate, "in_progress", stage, { ...run, lease, attempts: run.attempts + 1 }).catch(() => null);
    if (claimed) return { record: claimed, run: parse(claimed), lease };
  }
  return null;
}

async function failed(service: Service, record: OsRecord, run: MyinRun, code: string, files?: string[]) {
  const next: MyinRun = { ...run, lastError: { code: code.replace(/[^A-Z0-9_]/g, "").slice(0, 60) || "MYIN_FAILED", at: new Date().toISOString(), ...(files ? { files: files.slice(0, 30) } : {}) } };
  delete next.lease;
  const final = code === "MYIN_RUN_STALE" || code === "MYIN_OUR_IMAGE_NEEDED" || run.attempts >= 3;
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
      const audio = await synthesizeFishWav(myinBreathText(input.spoken[pending.index], pending.breath), { apiKey: process.env.FISH_API_KEY ?? "", referenceId: voiceReference, model: MYIN_VOICE_MODEL });
      const path = paragraphPath(record, run, pending.index);
      const { error } = await service.storage.from(YOUTUBE_VOICE_BUCKET).upload(path, new Uint8Array(audio.bytes), { contentType: audio.mimeType, upsert: true });
      if (error) throw new ApiError(502, "VOICE_STORAGE_UPLOAD_FAILED", "만든 음성을 저장하지 못했습니다.");
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

// Storage serves a replaced file's old bytes for a while (P01: the prep report was read back stale one second after upload),
// so every write goes to a new name: per lease for the render PC's files, per content for the OS's own.
const tag = (lease: string) => lease.slice(0, 8);
const bundlePath = (record: OsRecord, run: MyinRun, lease: string) => `${record.owner_id}/${run.sourceId}/${record.id}/myin-words-${tag(lease)}.json`;
const voicePartPath = (prefix: string, n: number) => `${prefix}.part${String(n).padStart(2, "0")}.wav`;
const previewPath = (prefix: string) => `${prefix}.preview.mp3`;

/** Render PC: the paragraphs still to voice, for Logan's breath model (tools/voice_timing in the installed package). */
export async function claimMyinBreath(service: Service = createServiceSupabase()) {
  const claimed = await claim(service, "breath_pending", 10 * 60_000);
  if (!claimed) return { idle: true as const };
  const { record, run, lease } = claimed;
  try {
    const input = await assertCurrent(service, run);
    return { runId: record.id, lease: lease.token, paragraphs: run.paragraphs.filter((p) => p.status === "pending").map((p) => ({ index: p.index, text: input.spoken[p.index] })) };
  } catch (error) {
    await failed(service, record, run, error instanceof ApiError ? error.code : "MYIN_CLAIM_FAILED");
    throw error;
  }
}

/** Render PC: the word positions to put a comma after (none when the package has no breath model); then Fish voices them. */
export async function completeMyinBreath(input: { runId: string; lease: string; breaths: { index: number; after: number[] }[] }, service: Service = createServiceSupabase()) {
  const { record, run } = await leased(service, input.runId, input.lease);
  const byIndex = new Map(input.breaths.map((b) => [b.index, b.after]));
  const paragraphs = run.paragraphs.map((p) => p.status === "pending" ? { ...p, breath: [...new Set(byIndex.get(p.index) ?? [])].sort((a, b) => a - b) } : p);
  const next: MyinRun = { ...run, paragraphs, attempts: 0 }; delete next.lease; delete next.lastError;
  await save(service, record, "backlog", "voice_pending", next);
  return { runId: record.id, stage: "voice_pending", commas: paragraphs.reduce((n, p) => n + (p.breath?.length ?? 0), 0) };
}

/** Render PC: take a run whose voice is complete, with the script file, each paragraph's text and wav, and where to put the bundle. */
const voicePrefix = (record: OsRecord, run: MyinRun, lease: string) => `${record.owner_id}/${run.sourceId}/${record.id}/voice48k-${tag(lease)}`;

/** The approved script and its Fish paragraphs, as the render PC's stage 1 reads them. */
async function voiceFiles(service: Service, run: MyinRun) {
  const input = await assertCurrent(service, run);
  const paragraphs = [];
  for (const p of run.paragraphs) {
    if (run.voiceOn) { paragraphs.push({ index: p.index, text: input.spoken[p.index] }); continue; }
    const { data, error } = await service.storage.from(YOUTUBE_VOICE_BUCKET).createSignedUrl(p.path ?? "", 1_800);
    if (error || !data) throw new ApiError(503, "MYIN_SIGN_FAILED", "음성 파일 주소를 만들지 못했습니다.");
    paragraphs.push({ index: p.index, text: input.spoken[p.index], url: data.signedUrl });
  }
  // The voice his stage_voice asks Fish for: the patched one makes every sentence itself, also for an older run that brings files.
  return { scriptMarkdown: input.markdown, paragraphs, fishVoice: fishVoice() };
}
export const fishVoice = () => ({ referenceId: process.env.FISH_VOICE_REFERENCE_ID?.trim() ?? "", model: MYIN_VOICE_MODEL });

/** A 숏폼 run goes only to a render PC whose worker has the vertical engine (it says `short`); an older worker keeps taking longforms. */
const fits = (short: boolean) => (run: MyinRun) => short || !run.layout;

export async function claimMyinWords(service: Service = createServiceSupabase(), short = false) {
  const claimed = await claim(service, "words_pending", WORDS_LEASE_MS, fits(short));
  if (!claimed) return { idle: true as const };
  const { record, run, lease } = claimed;
  try {
    const voice = await voiceFiles(service, run);
    const { data: upload, error } = await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).createSignedUploadUrl(bundlePath(record, run, lease.token), { upsert: true });
    if (error || !upload) throw new ApiError(503, "MYIN_SIGN_FAILED", "결과 업로드 주소를 만들지 못했습니다.");
    const prefix = voicePrefix(record, run, lease.token);
    const voiceUploadUrls = (await Promise.all(Array.from({ length: MYIN_VOICE_PARTS }, (_, n) =>
      service.storage.from(YOUTUBE_VOICE_BUCKET).createSignedUploadUrl(voicePartPath(prefix, n), { upsert: true })))).map(({ data }) => data?.signedUrl).filter(Boolean);
    const { data: preview } = await service.storage.from(YOUTUBE_VOICE_BUCKET).createSignedUploadUrl(previewPath(prefix), { upsert: true });
    // 음성 사전 (phase ④): the render PC voices with what the OS keeps; until the OS has one, his package's files stand.
    const dictionary = await readVoiceDictionary(service).catch(() => null);
    return { runId: record.id, lease: lease.token, ...voice, bundleUploadUrl: upload.signedUrl, ...(voiceUploadUrls.length === MYIN_VOICE_PARTS ? { voiceUploadUrls } : {}),
      ...(preview ? { previewUploadUrl: preview.signedUrl } : {}), ...(run.layout ? { layout: run.layout } : {}),
      ...(dictionary?.exists ? { dictionary: dictionaryFiles(dictionary.dictionary) } : {}),
      ...(run.voiceFixes?.length ? { fixes: run.voiceFixes.map(({ memo, say, read, video }) => ({ memo, ...(say ? { say } : {}), ...(read ? { read } : {}), ...(video ? { video } : {}) })) } : {}) };
  } catch (error) {
    await failed(service, record, run, error instanceof ApiError ? error.code : "MYIN_CLAIM_FAILED");
    throw error;
  }
}

async function leased(service: Service, runId: string, token: string) {
  const { data } = await service.from("os_records").select("*").eq("id", runId).eq("record_type", "ai_job").is("archived_at", null).maybeSingle();
  const run = data ? parse(data as OsRecord) : null;
  if (!data || !run || run.lease?.token !== token || Date.parse(run.lease.expiresAt) < Date.now() || (run.lease.stage && run.lease.stage !== data.stage))
    throw new ApiError(409, "MYIN_LEASE_LOST", "v13 작업의 처리 권한이 만료됐습니다.");
  return { record: data as OsRecord, run };
}

const bundleSchema = z.object({
  words: z.array(z.tuple([z.number(), z.number(), z.string()])).min(1),
  subtitlesAss: z.string().min(1), subtitleQc: z.string(), speech: z.string().min(1), durationSeconds: z.number().positive(),
}).passthrough();

/** Render PC: the bundle is up; the OS reads it back before the run moves on. */
export async function completeMyinWords(input: { runId: string; lease: string; voice?: { parts: number; bytes: number; sha256: string }; preview?: { bytes: number } }, service: Service = createServiceSupabase()) {
  const { record, run } = await leased(service, input.runId, input.lease);
  const path = bundlePath(record, run, input.lease);
  const { data, error } = await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).download(path);
  if (error || !data) throw new ApiError(409, "MYIN_BUNDLE_MISSING", "받아쓰기 결과 파일을 찾지 못했습니다.");
  const bundle = bundleSchema.safeParse(JSON.parse(await data.text()));
  if (!bundle.success) throw new ApiError(422, "MYIN_BUNDLE_INVALID", "받아쓰기 결과 형식이 맞지 않습니다.");
  const spoken = bundle.data.speech.replace(/\r/g, "").split("\n").filter((line) => line.trim() && !line.startsWith("#SECTION"));
  // A 숏폼 is matched by its confirmed 대본 (myinRunMatchesScript), not by the spoken copy, whose punctuation may differ from the run's.
  if (spoken.length !== run.paragraphs.length || (run.layout !== "short" && spoken.some((text, i) => sha(text) !== run.paragraphs[i].textHash)))
    throw new ApiError(422, "MYIN_PARAGRAPHS_MISMATCH", "영상 만드는 컴퓨터가 읽은 문단이 OS 원고와 다릅니다.");
  const next: MyinRun = { ...run, attempts: 0, words: { path, words: bundle.data.words.length,
    subtitleLines: (bundle.data.subtitlesAss.match(/^Dialogue:/gm) ?? []).length, durationSeconds: bundle.data.durationSeconds, at: new Date().toISOString(),
    ...(input.voice ? { voice: { path: voicePrefix(record, run, input.lease), ...input.voice } } : {}),
    ...(input.preview ? { preview: { path: previewPath(voicePrefix(record, run, input.lease)), bytes: input.preview.bytes } } : {}) } };
  delete next.lease; delete next.lastError; delete next.voiceFixes; delete next.voiceResume;
  // A fix asked from 최종 검토 returns to ④, where 「전체 영상 만들기」 makes the video again with the new voice.
  const stage = run.voiceResume ?? "words_ready";
  if (run.voiceResume) next.voiceChanged = { at: new Date().toISOString(), count: run.voiceFixes?.length ?? 0 };
  await save(service, record, "done", stage, next);
  // His dictionaries as the render PC left them (new lines from voice_fix, or his starting set): the OS keeps what it does not have.
  await reportVoiceDictionary((bundle.data as { dictionary?: Partial<VoiceDictionaryFiles> }).dictionary, { id: record.owner_id ?? "", team: record.team ?? "" }, service)
    .catch((error) => console.error(JSON.stringify({ event: "voice_dictionary_report_failed", message: error instanceof Error ? error.message : String(error) })));
  // A fixed voice replaces the one before it: those parts (~75 MB for 13 minutes) are removed so storage holds one voice per video.
  const old = run.words?.voice;
  if (old && input.voice && old.path !== next.words?.voice?.path)
    await service.storage.from(YOUTUBE_VOICE_BUCKET).remove([...Array.from({ length: old.parts }, (_, n) => voicePartPath(old.path, n)), ...(run.words?.preview ? [run.words.preview.path] : [])]).catch(() => undefined);
  return { runId: record.id, stage };
}

export async function failMyinWords(input: { runId: string; lease: string; code: string }, service: Service = createServiceSupabase()) {
  const { record, run } = await leased(service, input.runId, input.lease);
  // A voice fix that cannot be done leaves the video where it was (the voice it had still stands) instead of stopping it at stage 1.
  if (run.voiceFixes?.length && run.words && (input.code === "MYIN_VOICE_FIX_NO_VOICE" || run.attempts >= 3)) {
    const next: MyinRun = { ...run, attempts: 0, lastError: { code: input.code.replace(/[^A-Z0-9_]/g, "").slice(0, 60) || "MYIN_FAILED", at: new Date().toISOString() } };
    delete next.lease; delete next.voiceFixes; delete next.voiceResume;
    await save(service, record, "done", run.voiceResume ?? "words_ready", next);
    return { runId: record.id, retry: false };
  }
  await failed(service, record, run, input.code);
  return { runId: record.id, retry: run.attempts < 3 };
}

/** The subtitle check sheet and counts for the ③ panel. */
export async function myinWordsReport(actor: RequestActor, runId: string) {
  const { data: record } = await actor.supabase.from("os_records").select("*").eq("id", runId).eq("record_type", "ai_job").is("archived_at", null).maybeSingle();
  const run = record ? parse(record as OsRecord) : null;
  if (!run?.words) throw new ApiError(404, "MYIN_WORDS_NOT_READY", "받아쓰기·자막이 아직 없습니다.");
  const { data } = await createServiceSupabase().storage.from(YOUTUBE_VOICE_TIMING_BUCKET).download(run.words.path);
  if (!data) throw new ApiError(404, "MYIN_BUNDLE_MISSING", "받아쓰기 결과 파일을 찾지 못했습니다.");
  const bundle = JSON.parse(await data.text()) as { subtitleQc?: string };
  return { subtitleQc: String(bundle.subtitleQc ?? "").slice(0, 20_000) };
}

const auditRow = z.object({ 문단: z.number(), 시각: z.number(), 문장: z.string(), 문제: z.array(z.string()), 점수: z.number(), 긴호흡: z.number() }).passthrough();
/**
 * 음성 확인 (로건 OS 요청 2026-10-30): the sentences worth a listen from the render PC's voice_audit (a break scored 0.8 or more, or 20+
 * syllables without a comma), in time order, what the last fixes did, and the MP3 to listen with. Read here, not by the screen, so the
 * page never downloads the whole transcription.
 */
export async function myinVoiceCheck(actor: RequestActor, runId: string) {
  const { run } = await visibleRun(actor, runId);
  if (!run.words) throw new ApiError(404, "MYIN_WORDS_NOT_READY", "받아쓰기·자막이 아직 없습니다.");
  const service = createServiceSupabase();
  const { data } = await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).download(run.words.path);
  if (!data) throw new ApiError(404, "MYIN_BUNDLE_MISSING", "받아쓰기 결과 파일을 찾지 못했습니다.");
  const bundle = JSON.parse(await data.text()) as { audit?: unknown; fixes?: unknown };
  const rows = z.array(auditRow).safeParse(bundle.audit);
  const listen = rows.success ? rows.data.filter((row) => row.점수 >= 0.8 || row.긴호흡 > 0).sort((a, b) => a.시각 - b.시각).slice(0, 80)
    .map((row) => ({ at: row.시각, sentence: row.문장.slice(0, 300), issues: row.문제.slice(0, 6).map((issue) => issue.slice(0, 80)), score: row.점수, long: row.긴호흡 })) : null;
  const fixes = z.array(z.object({ memo: z.string(), ok: z.boolean(), report: z.string() }).passthrough()).safeParse(bundle.fixes);
  return { sentences: rows.success ? rows.data.length : null, listen, fixes: fixes.success ? fixes.data.map(({ memo, ok, report }) => ({ memo, ok, report })) : [],
    previewUrl: run.words.preview ? await sign(service, YOUTUBE_VOICE_BUCKET, run.words.preview.path) : null };
}

// ── 자막 한꺼번에 고치기 (유쓰 요청 1/8, 2026-11-02) ──
/** Stage 1's subtitles as the render PC made them, with the run's edits laid over; `key` names the edited words (none while nothing applies). */
async function subtitleState(service: Service, run: MyinRun) {
  if (!run.words) throw new ApiError(409, "MYIN_WORDS_NOT_READY", "받아쓰기·자막이 끝난 뒤에 고칠 수 있어요.");
  const { data } = await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).download(run.words.path);
  if (!data) throw new ApiError(409, "MYIN_BUNDLE_MISSING", "받아쓰기 결과 파일을 찾지 못했습니다.");
  const bundle = JSON.parse(await data.text()) as { subtitlesAss?: string; subtitleQc?: string };
  const ass = String(bundle.subtitlesAss ?? "");
  const edited = applySubtitleEdits(ass, run.subtitleEdits?.lines ?? []);
  return { ass, qc: String(bundle.subtitleQc ?? ""), edited, key: edited.applied ? sha(edited.ass) : undefined };
}
/** 채널 모양: what the render PC lays over a copy of the storyboard before it draws (the storyboard the OS keeps stays as written). */
const styleFor = (run: MyinRun) => run.style ? { style: { tone: run.style.tone, ending: run.style.ending, logo: run.style.logo } } : {};
/** What the render PC writes as subs_myin.ass before it draws: only once someone has edited (an edit taken back sends the original again). */
const subtitlesFor = async (service: Service, run: MyinRun) => run.subtitleEdits ? { subtitlesAss: (await subtitleState(service, run)).edited.ass } : {};
/** Lines can change while no voice is being made again and no full video is being drawn. */
const subtitlesOpen = (record: OsRecord, run: MyinRun) => Boolean(run.words) && !["breath_pending", "voice_pending", "words_pending", "final_pending"].includes(record.stage ?? "");

export async function myinSubtitles(actor: RequestActor, runId: string) {
  const { record, run } = await visibleRun(actor, runId);
  const state = await subtitleState(createServiceSupabase(), run);
  const edits = new Map((run.subtitleEdits?.lines ?? []).map((edit) => [edit.i, edit]));
  const conflicts = new Set(state.edited.conflicts);
  return {
    lines: subtitleLines(state.ass).map((line) => ({ ...line, original: line.text, text: !conflicts.has(line.i) && edits.get(line.i)?.to || line.text,
      edited: edits.has(line.i) && !conflicts.has(line.i), conflict: conflicts.has(line.i), ...(conflicts.has(line.i) ? { wanted: edits.get(line.i)?.to } : {}) })),
    issues: subtitleIssues(state.qc), open: subtitlesOpen(record, run), conflicts: state.edited.conflicts.length,
    edits: run.subtitleEdits ? { count: run.subtitleEdits.lines.length, name: run.subtitleEdits.name, at: run.subtitleEdits.at,
      voiceRemade: Boolean(run.words && run.words.at > run.subtitleEdits.at) } : null,
    // The finished video was made with other subtitles than these: 「고친 자막으로 전체 영상 다시 만들기」.
    pending: Boolean(run.final) && state.key !== run.final?.subtitles,
  };
}

export const myinSubtitleChangeSchema = z.object({ i: z.number().int().min(0).max(5000), to: z.string().max(400) }).strict();
/** The words of some lines (a 찾아 바꾸기 or one line); writing a line back as it was takes its edit away. Times never change. */
export async function saveMyinSubtitles(actor: RequestActor, runId: string, changes: z.infer<typeof myinSubtitleChangeSchema>[]) {
  const service = createServiceSupabase();
  const { record, run } = await visibleRun(actor, runId);
  if (!subtitlesOpen(record, run)) throw new ApiError(409, "MYIN_SUBTITLES_CLOSED", "음성이나 전체 영상을 만드는 중이에요. 끝난 뒤에 고쳐 주세요.");
  if (!changes.length) throw new ApiError(400, "MYIN_SUBTITLES_EMPTY", "고칠 자막을 골라 주세요.");
  const lines = subtitleLines((await subtitleState(service, run)).ass);
  const edits = new Map((run.subtitleEdits?.lines ?? []).map((edit) => [edit.i, edit]));
  for (const change of changes) {
    const line = lines[change.i];
    if (!line) throw new ApiError(400, "MYIN_SUBTITLE_LINE", `없는 자막 줄이에요: ${change.i}`);
    const problem = subtitleTextProblem(change.to);
    if (problem) throw new ApiError(400, "MYIN_SUBTITLE_TEXT", `${change.i}번 줄: ${problem}`);
    if (change.to === line.text) edits.delete(change.i); else edits.set(change.i, { i: change.i, from: line.text, to: change.to });
  }
  const next: MyinRun = { ...run, subtitleEdits: { lines: [...edits.values()].sort((a, b) => a.i - b.i), at: new Date().toISOString(), by: actor.id, name: actor.name } };
  if (next.subtitleEdits!.lines.length > 600) throw new ApiError(400, "MYIN_SUBTITLES_TOO_MANY", "한 영상에서 고칠 수 있는 자막은 600줄까지예요.");
  return presentMyinRun(await save(service, record, record.status, record.stage ?? "", next));
}

// ── Stage 3: photos, music, CTA voice and the render PC's preparation with Logan's preview check ──

const SHEET_BUCKET = "os-youtube-character"; // private, accepts PNG: Logan's preview sheets for the ③ panel
const md5 = (value: string) => createHash("md5").update(value).digest("hex");

async function runRecord(service: Service, runId: string) {
  const { data } = await service.from("os_records").select("*").eq("id", runId).eq("record_type", "ai_job").is("archived_at", null).maybeSingle();
  if (!data) throw new ApiError(404, "MYIN_RUN_NOT_FOUND", "v13 작업을 찾지 못했습니다.");
  const record = data as OsRecord;
  return { record, run: parse(record) };
}
/** A run the member can read (RLS); the writes that follow use the service client. */
async function visibleRun(actor: RequestActor, runId: string) {
  const { data } = await actor.supabase.from("os_records").select("id").eq("id", runId).eq("record_type", "ai_job").is("archived_at", null).maybeSingle();
  if (!data) throw new ApiError(404, "MYIN_RUN_NOT_FOUND", "v13 작업을 찾지 못했습니다.");
  return runRecord(createServiceSupabase(), runId);
}
async function storyboardJson(service: Service, run: MyinRun) {
  const { data } = await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).download(run.storyboard?.path ?? "");
  if (!data) throw new ApiError(409, "MYIN_STORYBOARD_MISSING", "기획표 파일을 찾지 못했습니다.");
  return JSON.parse(await data.text()) as Record<string, unknown> & { scenes: Record<string, unknown>[]; cta: { line: string }[] };
}
/** A changed storyboard (its sound only) as a new file — storage serves a replaced file's old bytes for a while. */
async function putStoryboard(service: Service, record: OsRecord, run: MyinRun, value: unknown) {
  const path = `${record.owner_id}/${run.sourceId}/${record.id}/myin-storyboard-${Date.now().toString(36)}.json`;
  const { error } = await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).upload(path, Buffer.from(JSON.stringify(value)), { contentType: "application/json", upsert: true });
  if (error) throw new ApiError(502, "MYIN_STORYBOARD_UPLOAD_FAILED", "기획표를 저장하지 못했습니다.");
  return { ...run.storyboard!, path };
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

/** The listed photos the storyboard uses; one the render PC cannot fetch by itself stops here, already at ③ (수정 요청으로 바꾼다). */
function photosInUse(run: MyinRun, story: Awaited<ReturnType<typeof storyboardJson>>) {
  const byFile = new Map((run.storyboard?.assets ?? []).map((a) => [a.file, a]));
  const used = [...myinReferencedFiles(story)].filter((file) => byFile.has(file));
  const unreachable = used.filter((file) => !run.ours?.[file] && !myinPhotoFetchUrl(byFile.get(file)!.url));
  if (unreachable.length) throw new ApiError(409, "MYIN_PREP_ASSETS", `자동으로 받을 수 없는 사진입니다(위키미디어, Unsplash 사진 파일 주소만): ${unreachable.join(", ")}. 수정 요청으로 바꿔 주세요.`);
  return used;
}

/** ③ 시안: the render PC lays the storyboard out with its photos (placeholders only where one cannot be fetched), runs Logan's music match and preview check, then the drafts. */
async function beginDraft(service: Service, record: OsRecord, run: MyinRun) {
  photosInUse(run, await storyboardJson(service, run));
  const next: MyinRun = { ...run, attempts: 0 };
  delete next.prepared; delete next.lastError; delete next.clips; delete next.clipsReview; delete next.sound; delete next.lease; retireFinal(next);
  return save(service, record, "backlog", "prep_pending", next);
}

/** ④ 자료 준비, after the drafts are confirmed: approve the photos the storyboard uses and queue the CTA voice, then the render PC prepares again. */
async function beginPrep(service: Service, record: OsRecord, run: MyinRun, by: string) {
  const story = await storyboardJson(service, run);
  const used = photosInUse(run, story);
  const at = new Date().toISOString();
  const assets = Object.fromEntries(used.map((file) => [file, { decision: "approved" as const, by, at }]));
  // 2026-10-29 로건: the CTA lines are made like the narration (his stage_cta: same way, EQ and level), so a render-PC voice run hands them
  // to the render PC as text instead of queueing the server's Fish request.
  // A member's own computer cannot make them (2026-11-03): the render PC makes them first and puts the files in the OS (claimMyinCta).
  const cta: NonNullable<MyinRun["cta"]> = story.cta.map((c, index) => {
    const kept = run.cta?.find((p) => p.index === index && p.textHash === sha(c.line));
    return kept && (kept.path || !run.localFinish) ? kept : { index, textHash: sha(c.line), status: run.voiceOn && !run.localFinish ? "ready" as const : "pending" as const };
  });
  const next: MyinRun = { ...run, assets, cta, attempts: 0 }; delete next.prepared; delete next.lastError; delete next.lease;
  return save(service, record, "backlog", cta.every((c) => c.status === "ready") ? "prep_pending" : "cta_pending", next);
}

/** [자료 준비 다시 하기]: after a finished check (e.g. a library track was missing) or a blocked attempt; a stop at the clips cuts only the clips again. */
export async function startMyinPrep(actor: RequestActor, runId: string) {
  const { record, run } = await visibleRun(actor, runId);
  const restart = record.status === "blocked" && ["cta_pending", "prep_pending", "clips_pending"].includes(record.stage ?? "");
  // A preview in review made from materials that changed since (사진 교체) is made again.
  const stalePreview = record.stage === "clips_review" && !run.clipsReview && Boolean(previewStale(run)?.length);
  if ((record.stage !== "prep_ready" && !restart && !stalePreview) || !run.storyboard || run.review?.decision !== "confirmed")
    throw new ApiError(409, "MYIN_PREP_NOT_OPEN", "기획표 확인이 끝난 뒤에 다시 할 수 있습니다.");
  await assertCurrent(createServiceSupabase(), run);
  // 멈춘 곳부터 (유쓰 요청 3/8): a stop while cutting the preview clips keeps the finished preparation and cuts the clips again.
  if (restart && record.stage === "clips_pending" && run.prepared && !run.clipsReview) {
    const next: MyinRun = { ...run, attempts: 0 }; delete next.lease; delete next.lastError;
    return presentMyinRun(await save(createServiceSupabase(), record, "backlog", "clips_pending", next));
  }
  return presentMyinRun(await (run.clipsReview ? beginPrep(createServiceSupabase(), record, run, actor.id) : beginDraft(createServiceSupabase(), record, run)));
}

/**
 * 내 컴퓨터로 ④ (2026-11-03): a member's own computer has neither the Fish key nor Logan's voice tools, so the render PC makes the run's
 * 구독 대사 lines with his stage_cta (like the narration) in its stage-1 folder and puts the files in the OS for that computer to use.
 */
const ctaPcPath = (record: OsRecord, run: MyinRun, c: { index: number; textHash: string }) =>
  `${record.owner_id}/${run.sourceId}/${record.id}/cta_${String(c.index).padStart(2, "0")}_${c.textHash.slice(0, 8)}_pc.wav`;
export async function claimMyinCta(service: Service = createServiceSupabase(), short = false) {
  const claimed = await claim(service, "cta_pending", WORDS_LEASE_MS, (run) => Boolean(run.voiceOn) && fits(short)(run));
  if (!claimed) return { idle: true as const };
  const { record, run, lease } = claimed;
  try {
    const story = await storyboardJson(service, run);
    const lines = [];
    for (const c of run.cta ?? []) if (c.status === "pending") lines.push({ index: c.index, uploadUrl: await uploadUrl(service, YOUTUBE_VOICE_BUCKET, ctaPcPath(record, run, c)) });
    return { runId: record.id, lease: lease.token, ...(run.layout ? { layout: run.layout } : {}), storyboard: myinDriftPairs(story), fishVoice: fishVoice(), lines };
  } catch (error) {
    await failed(service, record, run, error instanceof ApiError ? error.code : "MYIN_CTA_CLAIM_FAILED");
    throw error;
  }
}

export async function completeMyinCta(input: { runId: string; lease: string }, service: Service = createServiceSupabase()) {
  const { record, run } = await leased(service, input.runId, input.lease);
  const folder = `${record.owner_id}/${run.sourceId}/${record.id}`;
  const cta = (run.cta ?? []).map((c) => c.status === "pending" ? { ...c, status: "ready" as const, path: ctaPcPath(record, run, c), pc: true as const } : c);
  for (const c of cta.filter((line) => line.pc)) {
    const name = c.path!.slice(folder.length + 1);
    const { data } = await service.storage.from(YOUTUBE_VOICE_BUCKET).list(folder, { search: name });
    if (!Number(data?.find((o) => o.name === name)?.metadata?.size ?? 0)) throw new ApiError(409, "MYIN_BUNDLE_MISSING", "구독 대사 음성 파일을 찾지 못했습니다.");
  }
  const next: MyinRun = { ...run, cta, attempts: 0 }; delete next.lease; delete next.lastError;
  await save(service, record, "backlog", "prep_pending", next);
  return { runId: record.id, stage: "prep_pending" };
}

/** One CTA line of voice per call, the same Fish request as the paragraphs. */
async function processMyinCtaStep(service: Service) {
  // A render-PC voice run's lines are made by the render PC (claimMyinCta), never with the server's plain Fish request.
  const claimed = await claim(service, "cta_pending", 240_000, (run) => !run.voiceOn);
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
      const path = `${record.owner_id}/${run.sourceId}/${record.id}/cta_${String(pending.index).padStart(2, "0")}_${pending.textHash.slice(0, 8)}.wav`;
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

const prepBundlePath = (record: OsRecord, run: MyinRun, lease: string) => `${record.owner_id}/${run.sourceId}/${record.id}/myin-prep-${tag(lease)}.json`;
const sheetPath = (record: OsRecord, run: MyinRun, lease: string, n: number) => `${record.owner_id}/${run.sourceId}/${record.id}/preview_${tag(lease)}_${String(n).padStart(2, "0")}.png`;
const sign = async (service: Service, bucket: string, path: string) => {
  const { data, error } = await service.storage.from(bucket).createSignedUrl(path, 1_800);
  if (error || !data) throw new ApiError(503, "MYIN_SIGN_FAILED", "파일 주소를 만들지 못했습니다.");
  return data.signedUrl;
};

/**
 * What a staff Mac needs to rebuild the run's work folder the render PC made in stage 1: his processed voice.wav byte for byte
 * (its sentence gaps are a seeded random draw, never recomputed) and the frozen transcription and subtitles.
 */
type MyinVoice = NonNullable<NonNullable<MyinRun["words"]>["voice"]>;
const voiceDownload = async (service: Service, voice: MyinVoice) => ({
  urls: await Promise.all(Array.from({ length: voice.parts }, (_, n) => sign(service, YOUTUBE_VOICE_BUCKET, voicePartPath(voice.path, n)))), bytes: voice.bytes, sha256: voice.sha256 });
async function localSeed(service: Service, run: MyinRun) {
  const voice = run.words?.voice;
  if (!voice) throw new ApiError(409, "MYIN_LOCAL_VOICE_MISSING", "이 영상은 내 컴퓨터로 만들 음성 파일이 없어요. 영상 만드는 컴퓨터로 만들어 주세요.");
  return { voice: await voiceDownload(service, voice), wordsUrl: await sign(service, YOUTUBE_VOICE_TIMING_BUCKET, run.words?.path ?? "") };
}

/** 1단계 파일 내려받기 (owner request 2026-10-28): the processed voice in its parts (when the OS has it) and the bundle the subtitles are in. */
export async function myinDownloads(actor: RequestActor, runId: string) {
  const { run } = await visibleRun(actor, runId);
  if (!run.words) throw new ApiError(404, "MYIN_WORDS_NOT_READY", "받아쓰기·자막이 아직 없습니다.");
  const service = createServiceSupabase();
  return { voice: run.words.voice ? await voiceDownload(service, run.words.voice) : null, wordsUrl: await sign(service, YOUTUBE_VOICE_TIMING_BUCKET, run.words.path),
    previewUrl: run.words.preview ? await sign(service, YOUTUBE_VOICE_BUCKET, run.words.preview.path) : null, ...await subtitlesFor(service, run) };
}

/** 음성 확인·수정 (로건 OS 요청 2026-10-30): what may be asked of the render PC for one sentence. `read` is 「원래말=읽는소리」. */
export const myinVoiceFixSchema = z.object({ memo: z.string().trim().min(1).max(300), say: z.string().trim().min(1).max(300).optional(),
  read: z.string().trim().max(100).regex(/^[^=]+=[^=]+$/, "「원래말=읽는소리」로 써 주세요").optional(),
  // 최종 검토 음성 피드백: the memo's time is the video's; the render PC turns it into the voice's with the time map his render left.
  video: z.literal(true).optional() }).strict();
// The render PC's package with his voice_fix and voice_audit went live 2026-10-30 15:46 KST; a run keeps the engine it was cloned with,
// so only runs started after it can have one sentence made again.
const MYIN_VOICE_FIX_SINCE = "2026-10-30T06:46:00Z";
const voiceFixable = (record: Pick<OsRecord, "created_at">, run: MyinRun) => Boolean(run.voiceOn) && !run.layout && Date.parse(record.created_at) >= Date.parse(MYIN_VOICE_FIX_SINCE);
/** Stage 1's memos go to the render PC together: it redoes those sentences only and transcribes again (words_pending → words_ready). */
/** Stage 1's sentences with their voice times, from his voice_audit in the words bundle (none for a voice made before it). */
async function voiceSentences(service: Service, run: MyinRun) {
  const { data } = run.words ? await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).download(run.words.path) : { data: null };
  const rows = z.array(auditRow).safeParse(data ? (JSON.parse(await data.text()) as { audit?: unknown }).audit : undefined);
  return rows.success ? rows.data.map((row) => ({ at: row.시각, text: row.문장 })) : [];
}

/** 음성 고치기 범위 (0dfd9a37 보완 ①): what the memos would make again, before anything is sent or paid. Reading it changes nothing. */
export async function myinVoiceFixPlan(actor: RequestActor, runId: string, fixes: z.infer<typeof myinVoiceFixSchema>[]) {
  const { run } = await visibleRun(actor, runId);
  const sentences = await voiceSentences(createServiceSupabase(), run);
  return { ...planVoiceFix(fixes, sentences), sentences: sentences.length, final: Boolean(run.final) };
}

export async function requestMyinVoiceFix(actor: RequestActor, runId: string, memos: z.infer<typeof myinVoiceFixSchema>[]) {
  const service = createServiceSupabase();
  const { record, run } = await visibleRun(actor, runId);
  await assertCurrent(service, run);
  // Memos at the same sentence go as one fix (made and paid once); two different 읽는 글 or 발음 for one sentence are settled first.
  const plan = planVoiceFix(memos, await voiceSentences(service, run));
  if (plan.conflicts.length) throw new ApiError(400, "MYIN_VOICE_FIX_CONFLICT", `같은 문장에 읽는 글이나 발음이 둘 이상이에요. 하나만 남겨 주세요: ${plan.conflicts[0].join(" / ").slice(0, 200)}`);
  const fixes = plan.fixes;
  // Stage 1's memos before the storyboard; 최종 검토's (video: true) once the full video exists, from ④ or after it.
  const video = fixes.some((fix) => fix.video);
  if (video ? !["final_ready", "prep_ready"].includes(record.stage ?? "") || !run.final : record.stage !== "words_ready")
    throw new ApiError(409, "MYIN_VOICE_FIX_CLOSED", video ? "완성 영상이 나온 뒤에 최종 검토 피드백으로 음성을 고칠 수 있어요." : "받아쓰기·자막이 끝난 뒤, 기획표를 쓰기 전까지 고칠 수 있어요.");
  // His voice_fix works on the sentence files the render PC's own voice leaves; a 숏폼's package does not have it yet.
  if (!run.words || !voiceFixable(record, run)) throw new ApiError(409, "MYIN_VOICE_FIX_UNAVAILABLE", "이 영상은 문장 하나만 다시 만들 수 없어요(10/30 16시 전에 시작한 영상 · 숏폼).");
  if (!fixes.length) throw new ApiError(400, "MYIN_VOICE_FIX_EMPTY", "고칠 곳 메모를 하나 이상 남겨 주세요.");
  const at = new Date().toISOString();
  const next: MyinRun = { ...run, attempts: 0, voiceFixes: fixes.slice(0, 20).map((fix) => ({ ...fix, ...(video ? { video: true as const } : {}), by: actor.id, name: actor.name, at })),
    ...(video ? { voiceResume: "prep_ready" as const } : {}) };
  if (!video) delete next.voiceCheck;
  return presentMyinRun(await save(service, record, "backlog", "words_pending", next));
}
/** 「음성 확인 완료」 or 「확인 없이 바로 넘어가기」: who and when, for the record; stage 2 opens either way. */
export async function checkMyinVoice(actor: RequestActor, runId: string, skipped: boolean) {
  const service = createServiceSupabase();
  const { record, run } = await visibleRun(actor, runId);
  if (record.stage !== "words_ready" || !run.words) throw new ApiError(409, "MYIN_VOICE_CHECK_CLOSED", "받아쓰기·자막이 끝난 뒤에 확인할 수 있어요.");
  const next: MyinRun = { ...run, voiceCheck: { skipped, by: actor.id, name: actor.name, at: new Date().toISOString() } };
  return presentMyinRun(await save(service, record, record.status, "words_ready", next));
}

/**
 * 지난 영상 음성 (owner request 2026-10-28): runs whose stage 1 ran before the render PC left its voice.wav in the OS get it once from
 * the render PC's work folder (tools/myin-voice-backfill.mjs). Without a run: the runs still missing it; with one: where its parts go.
 */
export async function myinVoiceBackfill(input: { runId?: string }, service: Service = createServiceSupabase()) {
  if (!input.runId) {
    const { data, error } = await service.from("os_records").select("id").eq("record_type", "ai_job").eq("metadata->>kind", MYIN_RUN_KIND)
      .is("archived_at", null).not("metadata->words", "is", null).is("metadata->words->voice", null).order("created_at", { ascending: false }).limit(100);
    if (error) throw new ApiError(503, "MYIN_BACKFILL_LIST_FAILED", "음성이 없는 영상 목록을 읽지 못했습니다.");
    return { runs: (data ?? []).map((row) => row.id as string) };
  }
  const { record, run } = await runRecord(service, input.runId);
  if (!run.words || run.words.voice) return { uploadUrls: [] };
  const prefix = voicePrefix(record, run, "backfill");
  return { uploadUrls: await Promise.all(Array.from({ length: MYIN_VOICE_PARTS }, (_, n) => uploadUrl(service, YOUTUBE_VOICE_BUCKET, voicePartPath(prefix, n)))) };
}
export async function completeMyinVoiceBackfill(input: { runId: string; parts: number; bytes: number; sha256: string }, service: Service = createServiceSupabase()) {
  // Named, not spread: the route hands the whole request (with its action), and runs are stored strictly.
  const { runId, parts, bytes, sha256 } = input;
  const voice = { parts, bytes, sha256 };
  const { record, run } = await runRecord(service, runId);
  if (!run.words || run.words.voice) return { runId: record.id, saved: false };
  await save(service, record, record.status, record.stage, { ...run, words: { ...run.words, voice: { path: voicePrefix(record, run, "backfill"), ...voice } } });
  return { runId: record.id, saved: true };
}
/** Only a run whose stage 1 left its voice for staff Macs can be sent to one. */
const assertLocalReady = (run: MyinRun) => {
  if (run.layout) throw new ApiError(409, "MYIN_LOCAL_SHORT", "숏폼은 세로 엔진이 있는 영상 만드는 컴퓨터로만 만들어요.");
  if (!run.words?.voice) throw new ApiError(409, "MYIN_LOCAL_VOICE_MISSING", "이 영상은 내 컴퓨터로 만들 음성 파일이 없어요. 영상 만드는 컴퓨터로 만들어 주세요.");
};

/** Our images as the preparation was handed them: one put in while it runs makes that preparation's result stale. */
const oursKey = (run: MyinRun) => sha(JSON.stringify(Object.entries(run.ours ?? {}).map(([file, image]) => [file, image.path]).sort()));
/** The run's materials now (재료 고정): the storyboard by when the staff AI wrote it (the music match and sound edits keep that), the sound by its last edit. */
const materials = (run: MyinRun): MyinMaterials => ({ voice: run.words?.path ?? "", storyboard: run.storyboard?.at ?? "", sound: run.sound?.edited?.at ?? "",
  subtitles: run.subtitleEdits?.at ?? "", ours: oursKey(run).slice(0, 16), style: run.style ? `${run.style.id}@${run.style.version}` : "" });
const materialsKey = (run: MyinRun) => sha(JSON.stringify(materials(run)));
/** A job's result is from other materials than the run has now (a lease from before 2026-11-03 compared our images only). */
const staleResult = (run: MyinRun) => Boolean(run.lease?.input) && run.lease!.input !== (run.lease!.stage ? materialsKey(run) : oursKey(run));
const changedSince = (used: MyinMaterials | undefined, run: MyinRun, sound = false) => changedMaterials(used, materials(run), sound);
/** What makes the ③ preview in review not the one to confirm: a changed photo, storyboard, voice or style (subtitle text is checked at 최종 검토). */
const previewStale = (run: MyinRun) => run.clips ? changedSince(run.clips.used, run)?.filter((name) => name !== "자막") ?? null : null;

/**
 * The engine a ③/④ job is drawn with: the render PC's, which a member's own computer must also have to take the job (assertLocalEngine).
 * A 숏폼 is drawn by the vertical copy (MYIN_PKG_SHORT), which the fingerprint does not cover, so none is kept for it.
 */
const drawnWith = (run: MyinRun) => run.layout ? Promise.resolve(undefined) : renderPcEngine();

/** Render PC (or, with `owner`, that member's own Mac for a ③ draft): storyboard, approved files, CTA voice and where the sheets and report go. */
export async function claimMyinPrep(service: Service = createServiceSupabase(), owner?: string, short = false) {
  // A member's computer takes ④ only once every 구독 대사 line is a file it can use (it cannot make one).
  const claimed = await claim(service, "prep_pending", WORDS_LEASE_MS, (run) => placeFilter(owner)(run) && (!owner || Boolean(run.words?.voice)) && fits(short)(run)
    && (!owner || !run.clipsReview || (run.cta ?? []).every((c) => c.path)), materialsKey, drawnWith);
  if (!claimed) return { idle: true as const };
  const { record, run, lease } = claimed;
  try {
    const story = await storyboardJson(service, run);
    // ③ 시안 (no drafts confirmed yet): the storyboard's photos are fetched for the drafts too (대표 2026-10-27: the drafts are for judging
    // quality), not yet approved; no CTA voice (paid). A gray 「사진 자리」 stands in only where a photo cannot be fetched.
    const draft = !run.clipsReview;
    const folders = myinPhotoFolders(story);
    // 우리 이미지 (2026-11-03): an ours_ photo nobody uploaded stopped Logan's engine at ④ with FileNotFoundError. Say which ones instead;
    // uploading the last of them starts the preparation again (saveMyinOurImage).
    const waiting = draft ? [] : photoSources(run, folders).filter((photo) => photo.from === "none" && photo.file.startsWith("ours_")).map((photo) => photo.file);
    if (waiting.length) { await failed(service, record, run, "MYIN_OUR_IMAGE_NEEDED", waiting); return { idle: true as const }; }
    const placeholders = draft ? [...folders].flatMap(([file, kinds]) => kinds.map((kind) => ({ kind, file }))) : [];
    const ours = Object.fromEntries(await Promise.all(Object.entries(run.ours ?? {}).filter(([file]) => folders.has(file))
      .map(async ([file, image]) => [file, await sign(service, OUTPUT_BUCKET, image.path)] as const)));
    const assets = myinPrepPhotos(folders, run.storyboard?.assets ?? [], (file) => draft || run.assets?.[file]?.decision === "approved", ours);
    const cta = [];
    if (!draft) for (const c of run.cta ?? []) cta.push({ index: c.index, line: story.cta[c.index].line,
      ...(c.path ? { tag: md5(story.cta[c.index].line).slice(0, 8), url: await sign(service, YOUTUBE_VOICE_BUCKET, c.path), ...(c.pc ? { made: true } : {}) } : {}) });
    const sheets = Math.ceil(story.scenes.length / 12) + 1;
    const sheetUploads = [];
    for (let n = 1; n <= sheets; n++) {
      const { data } = await service.storage.from(SHEET_BUCKET).createSignedUploadUrl(sheetPath(record, run, lease.token, n), { upsert: true });
      if (data) sheetUploads.push(data.signedUrl);
    }
    const { data: bundle } = await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).createSignedUploadUrl(prepBundlePath(record, run, lease.token), { upsert: true });
    if (!bundle) throw new ApiError(503, "MYIN_SIGN_FAILED", "결과 업로드 주소를 만들지 못했습니다.");
    return { runId: record.id, lease: lease.token, ...(run.layout ? { layout: run.layout } : {}), draft, placeholders, storyboard: myinDriftPairs(story), assets, cta, ...(cta.some((c) => !c.url) ? { fishVoice: fishVoice() } : {}), siteCapture: story.scenes.some((sc) => sc.type === "site_ad"),
      sheetUploadUrls: sheetUploads, bundleUploadUrl: bundle.signedUrl, ...(owner ? { seed: await localSeed(service, run) } : {}), ...await subtitlesFor(service, run), ...styleFor(run) };
  } catch (error) {
    await failed(service, record, run, error instanceof ApiError ? error.code : "MYIN_PREP_CLAIM_FAILED");
    throw error;
  }
}

const drewWith = (run: MyinRun) => run.lease?.engine ? { engine: run.lease.engine } : {};

/** Render PC: the preview ran. Its "문구 못 찾음" lines decide whether the run may go on to the preview clips. */
export async function completeMyinPrep(input: { runId: string; lease: string }, service: Service = createServiceSupabase()) {
  const { record, run } = await leased(service, input.runId, input.lease);
  // An image (or another material) changed while this preparation ran: its result is from the old one, so it prepares again (유쓰 요청 2/8 · 3/8).
  if (staleResult(run)) {
    const again: MyinRun = { ...run, attempts: 0 }; delete again.lease; delete again.lastError;
    await save(service, record, "backlog", "prep_pending", again);
    return { runId: record.id, stage: "prep_pending", misses: 0, again: true };
  }
  const { data } = await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).download(prepBundlePath(record, run, input.lease));
  if (!data) throw new ApiError(409, "MYIN_BUNDLE_MISSING", "준비 결과 파일을 찾지 못했습니다.");
  const bundle = z.object({ misses: z.array(z.string()), sheets: z.number().int().min(0), musicCredits: z.array(z.string()).default([]),
    storyboard: z.record(z.unknown()).optional(), soundReport: z.string().optional() }).passthrough().parse(JSON.parse(await data.text()));
  const draft = !run.clipsReview;
  let { storyboard, sound } = run;
  if (draft && bundle.storyboard) {
    // ③: the render PC wrote Logan's music match (곡·앰비언스 키) into the storyboard; keep it only if nothing else changed.
    // Not kept is no stop: the drafts are made from our storyboard, with the music it has (2026-10-28 유쓰·로건).
    const at = new Date().toISOString();
    if (myinOnlySoundChanged(bundle.storyboard, await storyboardJson(service, run))) {
      storyboard = await putStoryboard(service, record, run, bundle.storyboard);
      sound = { report: (bundle.soundReport ?? "").slice(0, 20_000), at };
    } else sound = { report: "자동 선곡을 쓰지 않았어요. 선곡 결과에서 음악 말고 다른 칸도 바뀌어 있었어요. 음악은 기획표에 적힌 대로 깔립니다.", at };
  }
  // A listed photo replaced by ours is not used, so not credited; a candidate photo kept as ours brings its own credit.
  const credits = [...(run.storyboard?.assets ?? []).filter((a) => run.assets?.[a.file]?.decision === "approved" && !run.ours?.[a.file]).map((a) => `${a.file} — ${a.source} · ${a.license} · ${a.url}`),
    ...Object.entries(run.ours ?? {}).flatMap(([file, image]) => image.credit ? [`${file} — ${image.credit.source} · ${image.credit.license} · ${image.credit.url}`] : []),
    ...bundle.musicCredits.slice(0, 30)];
  const next: MyinRun = { ...run, storyboard, sound, attempts: 0, prepared: { path: prepBundlePath(record, run, input.lease), misses: bundle.misses.slice(0, 60),
    sheets: Array.from({ length: bundle.sheets }, (_, i) => sheetPath(record, run, input.lease, i + 1)), credits, at: new Date().toISOString(), ...drewWith(run) } };
  next.prepared!.used = materials(next);
  delete next.lease; delete next.lastError;
  if (draft) { delete next.clips; delete next.clipsReview; retireFinal(next); }
  if (!next.sound) delete next.sound;
  // ③ with nothing missing: the drafts are next, without anyone pressing a button. ④ stops here for the sound and photos check;
  // a 숏폼 has no sound to check (voice only), so its full video starts.
  const stage = bundle.misses.length ? "prep_ready" : draft ? "clips_pending" : run.layout ? "final_pending" : "prep_ready";
  if (stage === "final_pending") retireFinal(next);
  await save(service, record, stage === "prep_ready" ? "done" : "backlog", stage, next);
  // 화면 자동 검사 (2026-10-29): GPT reads the new sheets after this response, while the drafts are being made.
  if (bundle.sheets) await import("./myin-screen-check").then((module) => module.scheduleScreenCheck(record.id)).catch(() => undefined);
  return { runId: record.id, stage, misses: bundle.misses.length };
}

export async function failMyinPrep(input: { runId: string; lease: string; code: string }, service: Service = createServiceSupabase()) {
  const { record, run } = await leased(service, input.runId, input.lease);
  await failed(service, record, run, input.code);
  return { runId: record.id, retry: run.attempts < 3 };
}

/** 화면 자동 검사: a run's 점검 시트 as addresses GPT can fetch (30 minutes), with the storyboard scenes they show. */
export async function myinSheetSources(service: Service, runId: string) {
  const { record, run } = await runRecord(service, runId);
  const paths = run.prepared?.sheets ?? [];
  const story = paths.length && run.storyboard ? await storyboardJson(service, run).catch(() => null) : null;
  return { record, run, sheetsAt: run.prepared?.at ?? "", urls: await Promise.all(paths.map((path) => sign(service, SHEET_BUCKET, path))),
    scenes: story?.scenes ?? [], short: run.layout === "short" };
}

/** Logan's preview sheets for the ③ panel (10 minutes). */
export async function myinPreviewSheets(actor: RequestActor, runId: string) {
  const { run } = await visibleRun(actor, runId);
  const service = createServiceSupabase();
  return { sheets: await Promise.all((run.prepared?.sheets ?? []).map((path) => sign(service, SHEET_BUCKET, path))) };
}

// ── 우리 이미지 올리기 (2026-10-28 대표 · 로건): our own photo for a file name the storyboard uses, until the full video starts ──
const OUR_IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
const OUR_IMAGE_MAX_BYTES = 20 * 1024 * 1024;
const ourImageFolder = (record: OsRecord, run: MyinRun) => `${record.owner_id}/${run.sourceId}/${record.id}/our-images`;

async function ourImageRun(actor: RequestActor, runId: string, file?: string) {
  const { record, run } = await visibleRun(actor, runId);
  if (!run.storyboard) throw new ApiError(409, "MYIN_STORYBOARD_MISSING", "기획표가 나온 뒤에 이미지를 올릴 수 있어요.");
  const service = createServiceSupabase();
  const story = await storyboardJson(service, run);
  const folders = myinPhotoFolders(story);
  if (file !== undefined && !folders.has(file)) throw new ApiError(400, "MYIN_OUR_IMAGE_FILE", `기획표에 없는 사진 파일이에요: ${file}`);
  // 문제 장면의 그림 바꾸기 (유쓰 요청 2/8): also after the finished video — the run goes back to ④ and that video stays a version.
  return { service, record, run, folders, scenes: story.scenes, open: record.stage !== "final_pending" };
}

/** The photo files the storyboard uses and where each comes from: ours, a listed Unsplash · 위키미디어 photo, or neither. */
function photoSources(run: MyinRun, folders: Map<string, unknown>, scenes: Record<string, unknown>[] = []) {
  const listed = new Set((run.storyboard?.assets ?? []).filter((a) => myinPhotoFetchUrl(a.url)).map((a) => a.file));
  // The scene numbers (1-based, as the 점검 시트 and 장면 미리보기 name them) that show each file.
  const usedIn = (file: string) => scenes.flatMap((scene, i) => myinPhotoFolders(scene).has(file) ? [i + 1] : []);
  return [...folders.keys()].map((file) => ({ file, from: run.ours?.[file] ? "ours" as const : listed.has(file) ? "list" as const : "none" as const,
    by: run.ours?.[file]?.name ?? null, credit: run.ours?.[file]?.credit?.source ?? null, scenes: usedIn(file) }));
}

export async function myinPhotos(actor: RequestActor, runId: string) {
  const { record, run, folders, scenes, open } = await ourImageRun(actor, runId);
  return { open, finished: record.stage === "final_ready", photos: photoSources(run, folders, scenes) };
}

export async function myinOurImageUpload(actor: RequestActor, runId: string, file: string, type: string) {
  const { service, record, run, open } = await ourImageRun(actor, runId, file);
  if (!open) throw new ApiError(409, "MYIN_OUR_IMAGE_CLOSED", "전체 영상을 만드는 중이에요. 끝난 뒤에 올려 주세요.");
  const ext = OUR_IMAGE_TYPES[type];
  if (!ext) throw new ApiError(400, "MYIN_OUR_IMAGE_TYPE", "JPG · PNG · WEBP 이미지만 올릴 수 있어요.");
  const path = `${ourImageFolder(record, run)}/${md5(file).slice(0, 12)}-${Date.now().toString(36)}.${ext}`;
  return { path, uploadUrl: await uploadUrl(service, OUTPUT_BUCKET, path) };
}

/** The upload landed: keep it for that file. At ④ after the preparation (or a stop) it prepares again, as 「자료 준비 다시 하기」 would,
 * once no photo is left without a source, so the first of several uploads does not start one that stops at the next missing photo. */
export async function saveMyinOurImage(actor: RequestActor, runId: string, file: string, path: string, credit?: NonNullable<MyinRun["ours"]>[string]["credit"]) {
  const { service, record, run, folders, open } = await ourImageRun(actor, runId, file);
  const folder = ourImageFolder(record, run), name = path.slice(folder.length + 1);
  if (!open || !path.startsWith(`${folder}/`) || name.includes("/")) throw new ApiError(400, "MYIN_OUR_IMAGE_PATH", "이미지를 다시 올려 주세요.");
  const { data } = await service.storage.from(OUTPUT_BUCKET).list(folder, { search: name });
  const bytes = Number(data?.find((o) => o.name === name)?.metadata?.size ?? 0);
  if (!bytes) throw new ApiError(409, "MYIN_OUR_IMAGE_MISSING", "올린 이미지를 찾지 못했어요. 다시 올려 주세요.");
  if (bytes > OUR_IMAGE_MAX_BYTES) {
    await service.storage.from(OUTPUT_BUCKET).remove([path]);
    throw new ApiError(400, "MYIN_OUR_IMAGE_SIZE", "20MB 이하 이미지만 올릴 수 있어요.");
  }
  const next: MyinRun = { ...run, ours: { ...run.ours, [file]: { path, bytes, by: actor.id, name: actor.name, at: new Date().toISOString(), ...(credit ? { credit } : {}) } } };
  // After the finished video the run goes back to ④ (as 「4단계로 돌아가기」); that video stays a version and the new one is made from here.
  const back = record.stage === "final_ready" && Boolean(run.clipsReview && run.prepared);
  const saved = await save(service, record, back ? "done" : record.status, back ? "prep_ready" : record.stage ?? "", next);
  const again = run.clipsReview && photoSources(next, folders).every((photo) => photo.from !== "none")
    && (back || record.stage === "prep_ready" || (record.status === "blocked" && ["cta_pending", "prep_pending"].includes(record.stage ?? "")));
  return again ? startMyinPrep(actor, runId) : presentMyinRun(saved);
}

/**
 * 이 장면만 바꾸기 (유쓰 요청 2/8 보완, 2026-11-03): a photo file several scenes share gets a name of its own in one scene, which keeps
 * showing the same picture until it is replaced; the other scenes keep the file. A shared file is never replaced for all of them silently.
 */
export async function separateMyinPhoto(actor: RequestActor, runId: string, file: string, scene: number) {
  const { service, record, run, folders, scenes, open } = await ourImageRun(actor, runId, file);
  if (!open) throw new ApiError(409, "MYIN_OUR_IMAGE_CLOSED", "전체 영상을 만드는 중이에요. 끝난 뒤에 바꿔 주세요.");
  // A preparation at work would put back the storyboard it was handed (the ③ music match), losing the new name.
  if (run.lease && Date.parse(run.lease.expiresAt) > Date.now()) throw new ApiError(409, "MYIN_PLACE_BUSY", "지금 만드는 중이에요. 끝난 뒤에 바꿔 주세요.");
  const target = scenes[scene - 1];
  if (!target || !myinPhotoFolders(target).has(file)) throw new ApiError(400, "MYIN_PHOTO_SCENE", `${scene}번 장면에는 이 사진이 없어요.`);
  if (scenes.filter((sc) => myinPhotoFolders(sc).has(file)).length < 2) return { file, run: presentMyinRun(record) };
  const dot = file.lastIndexOf("."), stem = dot > 0 ? file.slice(0, dot) : file, ext = dot > 0 ? file.slice(dot) : "";
  let name = `${stem}_s${scene}${ext}`;
  for (let n = 2; folders.has(name); n++) name = `${stem}_s${scene}_${n}${ext}`;
  const story = await storyboardJson(service, run);
  // The same keys myinPhotoFolders reads: a scene's photo.file, an opening act's image, a 숏폼 broll cut's file.
  const rename = (o: unknown): void => {
    if (Array.isArray(o)) o.forEach(rename);
    else if (o && typeof o === "object") for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
      if (k === "image" && v === file) (o as Record<string, unknown>)[k] = name;
      else if ((k === "photo" || k === "broll") && v) for (const item of Array.isArray(v) ? v : [v]) if ((item as { file?: unknown })?.file === file) (item as { file: string }).file = name;
      rename(v);
    }
  };
  rename(story.scenes[scene - 1]);
  const copyOf = <T extends { file: string }>(list: T[]) => list.flatMap((item) => item.file === file ? [item, { ...item, file: name }] : [item]);
  if (Array.isArray(story.assets)) story.assets = copyOf(story.assets as { file: string }[]);
  const storyboard = await putStoryboard(service, record, run, story);
  const next: MyinRun = { ...run, storyboard: { ...storyboard, assets: copyOf(storyboard.assets) },
    ...(run.ours?.[file] ? { ours: { ...run.ours, [name]: run.ours[file] } } : {}), ...(run.assets?.[file] ? { assets: { ...run.assets, [name]: run.assets[file] } } : {}) };
  return { file: name, run: presentMyinRun(await save(service, record, record.status, record.stage ?? "", next)) };
}

// ── Stage 4: clips for Logan, then the full render, mix and handouts ──

const OUTPUT_BUCKET = "os-content-media"; // private; accepts PNG, PDF and SRT
const outPath = (record: OsRecord, run: MyinRun, name: string) => `${record.owner_id}/${run.sourceId}/${record.id}/${name}`;
const uploadUrl = async (service: Service, bucket: string, path: string) => {
  const { data, error } = await service.storage.from(bucket).createSignedUploadUrl(path, { upsert: true });
  if (error || !data) throw new ApiError(503, "MYIN_SIGN_FAILED", "업로드 주소를 만들지 못했습니다.");
  return data.signedUrl;
};

/** Render PC (or that member's own Mac): which clips to cut (the opening with its reel, then each metaphor scene) and where to put them. */
/** What the drafts are: the opening with its reel and each metaphor scene, or a 숏폼 whole (it is 30–45 seconds). */
const clipItems = (run: MyinRun) => run.layout ? [{ name: "clip_short", label: "숏폼 전체", scene: 1 }]
  : [{ name: "clip_opening", label: "오프닝 + 쇼릴", scene: 1 }, ...(run.storyboard?.metaphors ?? []).map((m) => ({ name: `clip_scene_${m.scene}`, label: `${m.scene}번 장면 · ${m.type}`, scene: m.scene }))];

export async function claimMyinClips(service: Service = createServiceSupabase(), owner?: string, short = false) {
  const claimed = await claim(service, "clips_pending", CLIPS_LEASE_MS, (run) => placeFilter(owner)(run) && (!owner || Boolean(run.words?.voice)) && fits(short)(run), materialsKey, drawnWith);
  if (!claimed) return { idle: true as const };
  const { record, run, lease } = claimed;
  try {
    const items = clipItems(run);
    const uploads = await Promise.all(items.map((item) => uploadUrl(service, ASSET_VIDEO_BUCKET, outPath(record, run, `${item.name}-${tag(lease.token)}.mp4`))));
    return { runId: record.id, lease: lease.token, ...(run.layout ? { layout: run.layout } : {}), clips: items.map((item, i) => ({ ...item, uploadUrl: uploads[i] })), ...(owner ? { seed: await localSeed(service, run) } : {}),
      ...await subtitlesFor(service, run), ...styleFor(run) };
  } catch (error) {
    await failed(service, record, run, error instanceof ApiError ? error.code : "MYIN_CLIPS_CLAIM_FAILED");
    throw error;
  }
}
const ASSET_VIDEO_BUCKET = "os-youtube-video";

export async function completeMyinClips(input: { runId: string; lease: string; names: string[] }, service: Service = createServiceSupabase()) {
  const { record, run } = await leased(service, input.runId, input.lease);
  // Materials changed while the clips were cut: not taken. A change the preparation used (our images, the storyboard) prepares again first.
  if (staleResult(run)) {
    const again: MyinRun = { ...run, attempts: 0 }; delete again.lease; delete again.lastError;
    const prepAgain = (changedSince(run.prepared?.used, run) ?? ["알 수 없음"]).length > 0;   // unknown (made before 2026-11-03): prepare again
    if (prepAgain) { delete again.prepared; delete again.clips; }
    await save(service, record, "backlog", prepAgain ? "prep_pending" : "clips_pending", again);
    return { runId: record.id, stage: prepAgain ? "prep_pending" : "clips_pending", again: true };
  }
  const labels = new Map(clipItems(run).map((item) => [item.name, item.label]));
  const items = input.names.filter((name) => labels.has(name)).map((name) => ({ name, label: labels.get(name)!, path: outPath(record, run, `${name}-${tag(input.lease)}.mp4`) }));
  if (!items.length) throw new ApiError(409, "MYIN_CLIPS_MISSING", "미리보기 영상이 올라오지 않았습니다.");
  const next: MyinRun = { ...run, attempts: 0, clips: { items, at: new Date().toISOString(), used: materials(run), ...drewWith(run) } };
  delete next.lease; delete next.lastError; delete next.clipsReview;
  await save(service, record, "done", "clips_review", next);
  return { runId: record.id, stage: "clips_review" };
}

/** Logan's OK on the clips starts the full render; changes go back through 수정 요청 on the storyboard. The same button restarts a stopped full render. */
export async function confirmMyinClips(actor: RequestActor, runId: string, note: string, place: "pc" | "local" = "pc") {
  const service = createServiceSupabase();
  const { record, run } = await visibleRun(actor, runId);
  await assertCurrent(service, run);
  if (record.stage !== "clips_review" || !run.clips) throw new ApiError(409, "MYIN_CLIPS_NOT_IN_REVIEW", "확인을 기다리는 미리보기가 없습니다.");
  // 사진 교체 (2/8 보완): a preview made before a photo (or other material) changed is not the one to confirm.
  const stale = previewStale(run);
  if (stale?.length) throw new ApiError(409, "MYIN_CLIPS_STALE", `미리보기를 만든 뒤 ${stale.join(" · ")}이(가) 바뀌었어요. [미리보기 다시 만들기]로 새로 만든 뒤 확인해 주세요.`);
  const next: MyinRun = { ...run, attempts: 0, clipsReview: { by: actor.id, name: actor.name, note: note.trim().slice(0, 2000), at: new Date().toISOString() } };
  draftPlace(next, actor, place);
  retireFinal(next);
  // 2026-10-27 대표: 시안 확인이 사진 허락 — ④ 자료 준비(사진 받기 · 구독 대사 음성)를 바로 시작한다.
  const saved = await save(service, record, "done", "clips_review", next);
  return presentMyinRun(await beginPrep(service, saved, parse(saved), actor.id));
}

/** ④ 끝: after the sound and photos check, the 1080p full video; the same button restarts a stopped one. */
export async function startMyinFinal(actor: RequestActor, runId: string) {
  const service = createServiceSupabase();
  const { record, run } = await visibleRun(actor, runId);
  await assertCurrent(service, run);
  const ready = record.stage === "prep_ready" && Boolean(run.clipsReview) && Boolean(run.prepared) && !run.prepared?.misses.length;
  // 자막 한꺼번에 고치기: a finished video whose subtitles were edited since is made again with them (a new version; the earlier one stays).
  const subtitles = record.stage === "final_ready" && Boolean(run.clipsReview && run.prepared && run.final && run.subtitleEdits)
    && (await subtitleState(service, run)).key !== run.final?.subtitles;
  if (!ready && !subtitles && !(record.stage === "final_pending" && record.status === "blocked"))
    throw new ApiError(409, "MYIN_FINAL_NOT_OPEN", "④ 자료 준비가 끝난 뒤에 전체 영상을 만들 수 있습니다.");
  const next: MyinRun = { ...run, attempts: 0 }; delete next.lastError; delete next.lease; retireFinal(next);
  return presentMyinRun(await save(service, record, "backlog", "final_pending", next));
}

/** ⑤ → ④: the finished video's sound needs another pass; the storyboard and drafts stay, only the full video is made again. */
export async function reopenMyinMaterials(actor: RequestActor, runId: string) {
  const service = createServiceSupabase();
  const { record, run } = await visibleRun(actor, runId);
  if (record.stage !== "final_ready" || !run.clipsReview || !run.prepared) throw new ApiError(409, "MYIN_REOPEN_NOT_OPEN", "완성 영상이 나온 뒤에 ④로 돌아갈 수 있습니다.");
  await assertCurrent(service, run);
  return presentMyinRun(await save(service, record, "done", "prep_ready", { ...run }));
}

/** ④ 사운드: the storyboard's music, ambience and effect lines as the editor shows them, with the scenes and the sounds this render PC has. */
export async function myinSoundState(actor: RequestActor, runId: string) {
  const service = createServiceSupabase();
  const { run } = await visibleRun(actor, runId);
  const story = await storyboardJson(service, run);
  return { plan: myinSoundPlan(story), catalog: (await readSoundCatalog())?.items ?? [],
    scenes: story.scenes.map((sc, i) => ({ scene: i + 1, type: String(sc.type), at: String(sc.at ?? (sc.at_time !== undefined ? `${sc.at_time}초` : "")) })) };
}

/** ④ 사운드 저장: the whole plan replaces the storyboard's sound fields, checked against the sound list and the transcription. */
export async function saveMyinSound(actor: RequestActor, runId: string, plan: MyinSoundPlan) {
  const service = createServiceSupabase();
  const { record, run } = await visibleRun(actor, runId);
  if (record.stage !== "prep_ready" || !run.clipsReview || !run.storyboard || !run.words) throw new ApiError(409, "MYIN_SOUND_NOT_OPEN", "④ 자료 준비에서 사운드를 고칠 수 있습니다.");
  // Only a run whose ③ ran Logan's music match has a render-PC copy that reads song keys; an older copy stops on a keyed song.
  if (!run.sound) throw new ApiError(409, "MYIN_SOUND_UNAVAILABLE", "이 영상은 사운드 창고 전 패키지로 시작해 음악은 기획표대로 들어가요.");
  await assertCurrent(service, run);
  const next = applyMyinSoundPlan(await storyboardJson(service, run), plan);
  const parsed = myinStoryboardSchema.safeParse(next);
  if (!parsed.success) throw new ApiError(422, "MYIN_SOUND_INVALID", "사운드를 적용한 기획표 형식이 맞지 않습니다.");
  const { data } = await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).download(run.words.path);
  if (!data) throw new ApiError(409, "MYIN_BUNDLE_MISSING", "받아쓰기 결과 파일을 찾지 못했습니다.");
  const words = (JSON.parse(await data.text()) as { words: [number, number, string][] }).words;
  const issues = myinSoundIssues(parsed.data, words, (await readSoundCatalog())?.items ?? null);
  if (issues.length) throw new ApiError(422, "MYIN_SOUND_INVALID", issues.slice(0, 8).join(" · "));
  const at = new Date().toISOString();
  const saved: MyinRun = { ...run, storyboard: await putStoryboard(service, record, run, next),
    sound: { report: run.sound?.report ?? "", at: run.sound?.at ?? at, edited: { by: actor.id, name: actor.name, at } } };
  return presentMyinRun(await save(service, record, "done", "prep_ready", saved));
}

// A 숏폼 has no handouts (한장정리 · 덱): it has no summary scene.
const finalFiles = (record: OsRecord, run: MyinRun, lease: string) => ({ video: outPath(record, run, `final_myin-${tag(lease)}.mp4`), srt: outPath(record, run, `subs_youtube-${tag(lease)}.srt`),
  ...(run.layout ? {} : { summary: outPath(record, run, `summary-${tag(lease)}.png`), deck: outPath(record, run, `deck-${tag(lease)}.pdf`) }) });

/** Render PC: where the finished video, the handouts, the YouTube subtitles and the check report go. */
export async function claimMyinFinal(service: Service = createServiceSupabase(), short = false, owner?: string) {
  const claimed = await claim(service, "final_pending", FINAL_LEASE_MS, (run) => placeFilter(owner)(run) && fits(short)(run), materialsKey, drawnWith);
  if (!claimed) return { idle: true as const };
  const { record, run, lease } = claimed;
  try {
    const files = finalFiles(record, run, lease.token);
    // The storyboard as ④ left it (sound edits made after the preparation), written into the render PC's copy before the render.
    return { runId: record.id, lease: lease.token, ...(run.layout ? { layout: run.layout } : {}), storyboard: myinDriftPairs(await storyboardJson(service, run)),
      videoUploadUrl: await uploadUrl(service, ASSET_VIDEO_BUCKET, files.video), srtUploadUrl: await uploadUrl(service, OUTPUT_BUCKET, files.srt),
      ...(files.summary && files.deck ? { summaryUploadUrl: await uploadUrl(service, OUTPUT_BUCKET, files.summary), deckUploadUrl: await uploadUrl(service, OUTPUT_BUCKET, files.deck) } : {}),
      ...(owner ? { seed: await localSeed(service, run) } : {}), ...await subtitlesFor(service, run), ...styleFor(run) };
  } catch (error) {
    await failed(service, record, run, error instanceof ApiError ? error.code : "MYIN_FINAL_CLAIM_FAILED");
    throw error;
  }
}

export async function completeMyinFinal(input: { runId: string; lease: string; bytes: number; durationSeconds: number; lufs: number; peak: number }, service: Service = createServiceSupabase()) {
  const { record, run } = await leased(service, input.runId, input.lease);
  if (staleResult(run)) {
    const again: MyinRun = { ...run, attempts: 0 }; delete again.lease; delete again.lastError;
    await save(service, record, "backlog", "final_pending", again);
    return { runId: record.id, stage: "final_pending", again: true };
  }
  const subtitles = run.subtitleEdits ? await subtitleState(service, run).then((state) => state.key, () => undefined) : undefined;
  const next: MyinRun = { ...run, attempts: 0, final: { ...finalFiles(record, run, input.lease), bytes: input.bytes, durationSeconds: input.durationSeconds, lufs: input.lufs, peak: input.peak,
    at: new Date().toISOString(), ...(subtitles ? { subtitles } : {}), used: materials(run), ...drewWith(run) } };
  delete next.lease; delete next.lastError; delete next.voiceChanged;
  await save(service, record, "done", "final_ready", next);
  return { runId: record.id, stage: "final_ready" };
}

export async function failMyinStage(input: { runId: string; lease: string; code: string }, service: Service = createServiceSupabase()) {
  const { record, run } = await leased(service, input.runId, input.lease);
  await failed(service, record, run, input.code);
  return { runId: record.id, retry: run.attempts < 3 };
}

/**
 * 만든 재료 · 설정 보기 (유쓰 요청 4/8, 2026-11-02): what this run actually used and made, read from its own record — never today's
 * defaults — and for each file whether storage still holds it (a fixed voice replaces the one before it; a listed photo is fetched by
 * the render PC and only its address is kept). Reading it changes and costs nothing.
 */
export async function myinRecord(actor: RequestActor, runId: string) {
  const { record, run } = await visibleRun(actor, runId);
  const service = createServiceSupabase();
  const folder = `${record.owner_id}/${run.sourceId}/${record.id}`;
  const listed = async (bucket: string, path = folder) => new Set(((await service.storage.from(bucket).list(path, { limit: 1000 })).data ?? []).map((o) => `${path}/${o.name}`));
  const [timing, voice, media, video, sheets, ours, engineNow] = await Promise.all([listed(YOUTUBE_VOICE_TIMING_BUCKET), listed(YOUTUBE_VOICE_BUCKET), listed(OUTPUT_BUCKET),
    listed(ASSET_VIDEO_BUCKET), listed(SHEET_BUCKET), listed(OUTPUT_BUCKET, `${folder}/our-images`), renderPcEngine()]);
  const short8 = (fp?: string) => fp?.slice(0, 8) ?? null;
  const kept = (set: Set<string>, path?: string) => path ? set.has(path) : null;
  const approved = (run.storyboard?.assets ?? []).filter((a) => a.kind !== "bgm" && run.assets?.[a.file]?.decision === "approved");
  return {
    startedAt: record.created_at, short: run.layout === "short", style: run.style ? { name: run.style.name, version: run.style.version } : null, earlierFinals: run.finals?.length ?? 0,
    script: { version: run.script.version, paragraphs: run.paragraphs.length },
    // 엔진 버전: what drew each result, and the render PC's engine now (a result made before 2026-11-04 has none).
    engine: { now: short8(engineNow), prepared: short8(run.prepared?.engine), clips: short8(run.clips?.engine), final: short8(run.final?.engine) },
    voice: { model: run.voiceModel, reference: run.voiceReferenceFingerprint.slice(0, 8), onPc: Boolean(run.voiceOn), changed: run.voiceChanged ?? null, check: run.voiceCheck ?? null },
    words: run.words ? { at: run.words.at, durationSeconds: run.words.durationSeconds, words: run.words.words, lines: run.words.subtitleLines, kept: kept(timing, run.words.path),
      voiceKept: run.words.voice ? kept(voice, voicePartPath(run.words.voice.path, 0)) : null } : null,
    storyboard: run.storyboard ? { at: run.storyboard.at, model: run.storyboard.model, scenes: run.storyboard.scenes, kept: kept(timing, run.storyboard.path),
      review: run.review ? { decision: run.review.decision, name: run.review.name, at: run.review.at } : null } : null,
    photos: [...approved.map((a) => ({ file: a.file, from: `${a.source} · ${a.license}`, url: a.url, kept: null as boolean | null })),
      ...Object.entries(run.ours ?? {}).map(([file, image]) => ({ file, from: `우리 이미지 · ${image.name}`, url: null, kept: kept(ours, image.path) }))],
    sound: run.sound ? { at: run.sound.at, edited: run.sound.edited ? { name: run.sound.edited.name, at: run.sound.edited.at } : null } : null,
    prepared: run.prepared ? { at: run.prepared.at, sheets: run.prepared.sheets.length, sheetsKept: run.prepared.sheets.filter((path) => sheets.has(path)).length, changed: changedSince(run.prepared.used, run) } : null,
    clips: run.clips ? { at: run.clips.at, count: run.clips.items.length, kept: run.clips.items.filter((item) => video.has(item.path)).length, changed: changedSince(run.clips.used, run),
      review: run.clipsReview ? { name: run.clipsReview.name, at: run.clipsReview.at } : null } : null,
    final: run.final ? { at: run.final.at, durationSeconds: run.final.durationSeconds, bytes: run.final.bytes, lufs: run.final.lufs, peak: run.final.peak, changed: changedSince(run.final.used, run, true),
      files: [["영상", kept(video, run.final.video)], ["자막 SRT", kept(media, run.final.srt)], ["한 장 정리", kept(media, run.final.summary)], ["덱 PDF", kept(media, run.final.deck)]]
        .filter(([, value]) => value !== null).map(([name, value]) => ({ name: name as string, kept: value as boolean })) } : null,
  };
}

/**
 * 예전 설정 가져오기 (보완 요청 4/8): the 채널 모양 that other videos were made with, newest first, so a new video's start can be filled
 * with one. Only the start's choice is filled; nothing is made or changed until 음성 만들기, and the earlier videos stay as they are.
 */
export async function myinEarlierStyles(actor: RequestActor, sourceId: string) {
  const { data } = await actor.supabase.from("os_records").select("parent_id,created_at,style:metadata->style").eq("record_type", "ai_job").eq("metadata->>kind", MYIN_RUN_KIND)
    .neq("parent_id", sourceId).not("metadata->style", "is", null).is("archived_at", null).order("created_at", { ascending: false }).limit(40);
  const latest = new Map<string, { at: string; style: NonNullable<MyinRun["style"]> }>();
  for (const row of (data ?? []) as { parent_id: string; created_at: string; style: MyinRun["style"] }[])
    if (row.style && !latest.has(row.parent_id) && latest.size < 8) latest.set(row.parent_id, { at: row.created_at, style: row.style });
  if (!latest.size) return { videos: [] };
  const { data: sources } = await actor.supabase.from("os_records").select("id,title").in("id", [...latest.keys()]).is("archived_at", null);
  const titles = new Map((sources ?? []).map((source) => [source.id as string, String(source.title)]));
  return { videos: [...latest].filter(([id]) => titles.has(id)).map(([id, { at, style }]) => ({ title: titles.get(id)!, at, style: { id: style.id, name: style.name, version: style.version } })) };
}

/** Short-lived addresses of the clips and the finished files for the ③ panel. */
export async function myinOutputs(actor: RequestActor, runId: string, at?: string) {
  const { run } = await visibleRun(actor, runId);
  const service = createServiceSupabase();
  const read = (bucket: string, path?: string) => path ? sign(service, bucket, path) : Promise.resolve(null);
  // An earlier version of this run's finished video (최종 검토 버전 비교), found by when it was made.
  const final = at ? [...(run.finals ?? []), ...(run.final ? [run.final] : [])].find((item) => item.at === at) : run.final;
  return {
    clips: await Promise.all((run.clips?.items ?? []).map(async (item) => ({ label: item.label, url: await read(ASSET_VIDEO_BUCKET, item.path) }))),
    video: await read(ASSET_VIDEO_BUCKET, final?.video), summary: await read(OUTPUT_BUCKET, final?.summary),
    deck: await read(OUTPUT_BUCKET, final?.deck), srt: await read(OUTPUT_BUCKET, final?.srt),
  };
}

/**
 * 영상 편집기 읽기 (로건 개발 문서 「OS 영상 편집기」 2026-11-03 §4-2): a video's latest run as the AI that edits it reads it — its
 * versions, the storyboard scenes with when each starts in the voice, the subtitle lines, and what it may use. Reading changes nothing.
 * The caller has already been allowed to the video (an AI key only for a video its owner made or is assigned).
 */
export async function myinEditorView(actor: RequestActor, sourceId: string, view: "summary" | "scenes" | "subtitles" | "assets") {
  const { data } = await actor.supabase.from("os_records").select("*").eq("parent_id", sourceId).eq("record_type", "ai_job")
    .eq("metadata->>kind", MYIN_RUN_KIND).is("archived_at", null).order("created_at", { ascending: false }).limit(1);
  const record = data?.[0] as OsRecord | undefined;
  if (!record) throw new ApiError(404, "MYIN_RUN_MISSING", "이 영상은 아직 영상 만들기를 시작하지 않았어요.");
  const run = parse(record), service = createServiceSupabase();
  const versions = [...(run.finals ?? []), ...(run.final ? [run.final] : [])].map((final, i) => ({ v: i + 1, at: final.at, durationSeconds: final.durationSeconds, lufs: final.lufs }));
  if (view === "summary") return { runId: record.id, stage: record.stage, status: record.status, short: run.layout === "short", voiceSeconds: run.words?.durationSeconds ?? null,
    scenes: run.storyboard?.scenes ?? 0, versions, current: versions.at(-1)?.v ?? null,
    note: "시각은 음성 기준(초)이에요. 완성 영상의 시각은 제목 · 구독 멘트 · 쇼릴에서 멈춘 만큼 더 늦어요." };
  if (!run.storyboard || !run.words) throw new ApiError(409, "MYIN_STORYBOARD_MISSING", "기획표가 나온 뒤에 읽을 수 있어요.");
  if (view === "subtitles") return { runId: record.id, edited: Boolean(run.subtitleEdits), lines: subtitleLines((await subtitleState(service, run)).edited.ass) };
  const story = await storyboardJson(service, run);
  if (view === "assets") {
    const [sounds, diagrams] = await Promise.all([readSoundCatalog().catch(() => null), readDiagramCatalog().catch(() => null)]);
    return { runId: record.id, photos: photoSources(run, myinPhotoFolders(story), story.scenes), sounds: sounds?.items ?? [],
      diagrams: (diagrams?.items ?? []).map(({ type, name, when, slots }) => ({ type, name, when, slots })) };
  }
  const { data: file } = await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).download(run.words.path);
  const words = file ? ((JSON.parse(await file.text()) as { words?: [number, number, string][] }).words ?? []) : [];
  const starts = myinSceneStarts(story.scenes, words);
  return { runId: record.id, scenes: story.scenes.map((scene, i) => ({ n: i + 1, voiceStart: starts[i], ...scene })),
    music_cues: (story as { music_cues?: unknown }).music_cues ?? null, cta: story.cta, end: (story as { end?: unknown }).end ?? null };
}

async function latestRun(service: Service, sourceId: string) {
  const { data } = await service.from("os_records").select("*").eq("parent_id", sourceId).eq("record_type", "ai_job")
    .eq("metadata->>kind", MYIN_RUN_KIND).is("archived_at", null).order("created_at", { ascending: false }).limit(1);
  const record = data?.[0] as OsRecord | undefined;
  return record ? { record, run: parse(record) } : null;
}
/** 영상 편집기: when the OS final an edit starts from (the one 최종 검토 shows) was made, or null before the first. */
export async function myinFinalAt(service: Service, sourceId: string) {
  return (await latestRun(service, sourceId))?.run.final?.at ?? null;
}

const editFiles = (record: OsRecord, run: MyinRun, id: string) => ({ video: outPath(record, run, `final_edit-${tag(id)}.mp4`), srt: outPath(record, run, `subs_youtube-edit-${tag(id)}.srt`) });
/** 영상 편집기 확정: where the edited final and its YouTube subtitles go, beside the run's own finals. */
export async function myinEditUploads(service: Service, sourceId: string, confirmId: string) {
  const latest = await latestRun(service, sourceId);
  if (!latest?.run.final) throw new ApiError(409, "EDIT_NO_FINAL", "OS에 완성본이 나온 뒤에 확정할 수 있어요.");
  const files = editFiles(latest.record, latest.run, confirmId);
  return { videoUploadUrl: await uploadUrl(service, ASSET_VIDEO_BUCKET, files.video), srtUploadUrl: await uploadUrl(service, OUTPUT_BUCKET, files.srt) };
}

/**
 * 영상 편집기 확정: the uploaded edit becomes the run's newest final (the one before it stays a version), only while the final it was
 * edited from is still the newest and the OS is not making the video again — two confirms cannot both land (the save checks the version).
 * The handouts (한 장 정리 · 덱) stay the ones the OS made.
 */
export async function myinAddEditFinal(service: Service, sourceId: string, input: { basedOn: string; bytes: number; lufs: number; peak: number; edit: z.infer<typeof editFinalSchema> }) {
  const latest = await latestRun(service, sourceId);
  if (!latest?.run.final) throw new ApiError(409, "EDIT_NO_FINAL", "OS에 완성본이 나온 뒤에 확정할 수 있어요.");
  const { record, run } = latest;
  if (run.final?.at !== input.basedOn) throw new ApiError(409, "EDIT_BASE_MOVED", "다른 곳에서 먼저 새 완성본이 나왔어요. 그 완성본에서 다시 고쳐 주세요(내 버전은 내 컴퓨터에 그대로 있어요).");
  if (record.stage !== "final_ready") throw new ApiError(409, "EDIT_RUN_BUSY", "OS에서 이 영상을 다시 만드는 중이에요. 끝난 뒤 그 완성본에서 다시 고쳐 주세요.");
  const files = editFiles(record, run, input.edit.id);
  const size = async (bucket: string, path: string) => {
    const slash = path.lastIndexOf("/");
    const { data } = await service.storage.from(bucket).list(path.slice(0, slash), { search: path.slice(slash + 1), limit: 5 });
    return (data ?? []).find((o) => o.name === path.slice(slash + 1))?.metadata?.size as number | undefined;
  };
  if (await size(ASSET_VIDEO_BUCKET, files.video) !== input.bytes) throw new ApiError(409, "EDIT_UPLOAD_MISSING", "확정본 영상이 다 올라가지 않았어요. 다시 확정해 주세요.");
  if (!await size(OUTPUT_BUCKET, files.srt)) throw new ApiError(409, "EDIT_UPLOAD_MISSING", "확정본 자막이 다 올라가지 않았어요. 다시 확정해 주세요.");
  const next: MyinRun = { ...run };
  const handouts = { ...(run.final.summary ? { summary: run.final.summary } : {}), ...(run.final.deck ? { deck: run.final.deck } : {}) };
  retireFinal(next);
  next.final = { ...files, ...handouts, bytes: input.bytes, durationSeconds: input.edit.check.end, lufs: input.lufs, peak: input.peak, at: new Date().toISOString(), engine: input.edit.engine, edit: input.edit };
  await save(service, record, record.status, record.stage ?? "final_ready", next);
  return { at: next.final.at, v: (next.finals?.length ?? 0) + 1 };
}

/** 영상 편집기: every finished version, oldest first, and for one confirmed from an editor who, where and from which of its versions. */
export async function myinFinalVersions(service: Service, sourceId: string) {
  const latest = await latestRun(service, sourceId);
  const all = latest ? [...(latest.run.finals ?? []), ...(latest.run.final ? [latest.run.final] : [])] : [];
  return all.map((final, i) => ({ v: i + 1, at: final.at, durationSeconds: final.durationSeconds,
    edit: final.edit ? { name: final.edit.name, pc: final.edit.pc, fromVersion: final.edit.fromVersion, note: final.edit.note, orders: final.edit.orders.length } : null }));
}

/** 문장 테이크: the video whose voice a sentence take must match — its latest run, voiced on the render PC, a longform. */
export async function myinSayTarget(service: Service, sourceId: string) {
  const latest = await latestRun(service, sourceId);
  if (!latest) throw new ApiError(404, "MYIN_RUN_MISSING", "이 영상은 아직 영상 만들기를 시작하지 않았어요.");
  if (!voiceFixable(latest.record, latest.run)) throw new ApiError(409, "MYIN_SAY_UNAVAILABLE", "이 영상은 문장만 새로 읽을 수 없어요(10/30 16시 전에 시작한 영상 · 숏폼).");
  return { runId: latest.record.id, ownerId: latest.record.owner_id ?? "" };
}

/** 다른 컴퓨터에서 이어받기: a final's files (the newest, or the one made at `at`) for 30 minutes, with what its edit left. */
export async function myinFinalForHandoff(service: Service, sourceId: string, at?: string) {
  const latest = await latestRun(service, sourceId);
  const all = latest ? [...(latest.run.finals ?? []), ...(latest.run.final ? [latest.run.final] : [])] : [];
  const final = at ? all.find((item) => item.at === at) : latest?.run.final;
  if (!final) throw new ApiError(404, "EDIT_FINAL_NOT_FOUND", "그 완성본을 찾지 못했어요.");
  return { at: final.at, v: all.indexOf(final) + 1, durationSeconds: final.durationSeconds, edit: final.edit ?? null,
    videoUrl: await sign(service, ASSET_VIDEO_BUCKET, final.video), srtUrl: await sign(service, OUTPUT_BUCKET, final.srt) };
}
