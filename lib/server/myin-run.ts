import { createHash, randomUUID } from "node:crypto";
import { z } from "zod";
import { ApiError } from "@/lib/http";
import { myinBreathText, myinCleanScript, myinRunMatchesScript, myinScriptMarkdown } from "@/lib/myin-script";
import { localOwner, movePinned, pinnedElsewhere, placeFilter, settingsPlace } from "@/lib/myin-local";
import { changedMaterials, type MyinMaterials } from "@/lib/myin-materials";
import { myinStop } from "@/lib/myin-stop";
import { planVoiceFix } from "@/lib/myin-voice-plan";
import { applySubtitleEdits, subtitleIssues, subtitleLines, subtitleTextProblem } from "@/lib/myin-subtitles";
import { applyMyinSoundPlan, MYIN_METAPHOR_TYPES, myinColumnMaterials, myinDriftPairs, myinOnlySoundChanged, myinTextPairs, myinPhotoFetchUrl, myinPhotoFolders, myinPrepPhotos, myinSceneStarts, myinSoundIssues, myinSoundPlan, myinCuesAsScript, myinStoryboardSchema, type MyinSoundPlan } from "@/lib/myin-storyboard";
import { diagramCatalogTypes } from "@/lib/diagram-catalog";
import { checkMyinStory } from "./myin-storyboard-job";
import type { OsRecord } from "@/lib/record-types";
import { createServiceSupabase } from "@/lib/supabase/server";
import type { RequestActor } from "./auth";
import { MYIN_VOICE_TUNING, synthesizeFishWav } from "./fish-audio";
import { readDiagramCatalog } from "./diagram-catalog";
import { readSoundCatalog } from "./sound-catalog";
import { readYoutubeAutomationInput } from "./youtube-automation-input";
import { RENDER_PC_NAME, renderPcEngine, renderPcGone, renderPcJobs } from "./youtube-render-pc";
import { readChannelStyles } from "./youtube-channel-styles";
import { channelOf, channelToneSchema, pinStyle, type ChannelStyle } from "@/lib/youtube-process/channel-style";
import { assertSpokenScript } from "./youtube-script-canon";
import { notify } from "./youtube-process";
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
// 음성 고르기 v2 (2026-11-11): the render PC makes every longform sentence four times and transcribes each take — about 27 s a sentence
// on the Mac mini — and a result after the lease is refused (leased), so a longform voice lease grows with the script.
// ponytail: 3 minutes a paragraph assumes ~4–6 sentences each; measure on the first real runs.
export const wordsLeaseMs = (run: { voiceOn?: unknown; layout?: string | null; paragraphs: unknown[] }) =>
  run.voiceOn && !run.layout ? WORDS_LEASE_MS + run.paragraphs.length * 3 * 60_000 : WORDS_LEASE_MS;
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
  subtitles: hex.optional(), used: materialsSchema.optional(), engine: engineFp.optional(), edit: editFinalSchema.optional(),
  /** 피드용 크기 (대표 2026-11-19): a web short's 1:1 and 4:5 copies of the same video, made with it. */
  sizes: z.object({ "1:1": z.string(), "4:5": z.string() }).strict().optional() }).strict();
// input: what the job was handed (the materials key; before 2026-11-03 a preparation's our images) — a result made from other input is
// not taken (유쓰 요청 2/8 · 3/8). stage: the stage it was claimed at; a run that moved on (수정 요청, a new start) takes no late result.
const leaseSchema = z.object({ token: z.string().uuid(), expiresAt: z.string().datetime(), startedAt: z.string().datetime().optional(), input: z.string().regex(/^[a-f0-9]{64}$/).optional(),
  stage: z.string().max(40).optional(), engine: engineFp.optional() }).strict();
const takeName = z.string().regex(/^p\d{2}_s\d{2}_\d{1,3}_t\.wav$/);
const takeFix = z.object({ p: z.number().int().min(0).max(150), text: z.string().trim().min(1).max(300), name: takeName }).strict();
const pauseFix = z.object({ p: z.number().int().min(0).max(150), text: z.string().trim().min(1).max(300), before: z.number().min(0).max(1), after: z.number().min(0).max(1) }).strict();
const runSchema = z.object({
  kind: z.literal(MYIN_RUN_KIND), runKey: hex, sourceId: z.string().uuid(), inputKey: hex, script: versionRef, scriptMarkdownHash: hex,
  // 숏폼 (2026-10-28): drawn 9:16 by the render PC's vertical copy of Logan's engine (MYIN_PKG_SHORT); no handouts, no staff-Mac drafts.
  layout: z.literal("short").optional(),
  // 웹 숏폼 (2026-11-19): a 숏폼 drawn by the web short renderer (tools/web-short) from a scene-template storyboard, not the vertical engine.
  renderer: z.literal("web").optional(),
  // 피드용 1:1 · 4:5 (대표 2026-11-19): asked for once, every later final of this web short comes in the two feed sizes too.
  feedSizes: z.literal(true).optional(),
  // 롱폼에서 나온 숏폼 (「롱폼 재활용 숏폼 정본」 §1): no new voice — the render PC cuts the longform run's voice at these voice times
  // (moved into the silence nearby) and speeds it 1.25×; the run stays on the PC that holds that voice.
  recycle: z.object({ from: z.string().uuid(), cuts: z.array(z.tuple([z.number().min(0), z.number().positive()])).min(1).max(8) }).strict().optional(),
  // 로건 사람 말투 음성 (2026-10-29): the render PC makes the voice itself, so the paragraphs never get OS files.
  voiceOn: z.literal("render_pc").optional(),
  voiceModel: z.literal(MYIN_VOICE_MODEL), voiceReferenceFingerprint: hex,
  // 채널 목소리 (다채널 2단계, 2026-11-07): the Fish voice of the video's channel, when its card names one; none = the OS's own voice.
  voiceReference: z.string().regex(/^[A-Za-z0-9_-]{1,64}$/).optional(),
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
  // 테이크 바꾸기 · 앞뒤 쉼 (요청 2번, 2026-11-17): a sentence put back with another take the voice already made, or given more pause, with no Fish.
  voiceFixes: z.array(z.object({ memo: z.string().min(1).max(300), say: z.string().max(300).optional(), read: z.string().max(100).optional(),
    video: z.literal(true).optional(), take: takeFix.optional(), pause: pauseFix.optional(),
    by: z.string().uuid(), name: z.string(), at: z.string().datetime() }).strict()).max(20).optional(),
  // 최종 검토 음성 피드백 (phase ③): a fix asked after the full video goes back to ④ when done, and says the voice changed until the
  // full video is made again.
  // Where a fix asked after the words goes back to: ④ (최종 검토 · after the preparation), the storyboard to confirm, or ③ drawn again (draft).
  voiceResume: z.enum(["prep_ready", "storyboard_review", "draft"]).optional(),
  // 테이크 고르기 (요청 2번, 2026-11-17): one sentence's takes, put up to listen to by the render PC that made the voice (nothing paid).
  takes: z.object({ p: z.number().int().min(0).max(150), text: z.string().max(300), state: z.enum(["pending", "listing", "ready", "failed"]), at: z.string().datetime(),
    attempts: z.number().int().min(0).max(5), token: z.string().uuid().optional(), expiresAt: z.string().datetime().optional(), code: z.string().max(80).optional(),
    files: z.array(z.object({ name: takeName, path: z.string(), current: z.boolean() }).strict()).max(12).optional() }).strict().optional(),
  voiceChanged: z.object({ at: z.string().datetime(), count: z.number().int().min(0) }).strict().optional(),
  voiceCheck: z.object({ skipped: z.boolean(), by: z.string().uuid(), name: z.string(), at: z.string().datetime() }).strict().optional(),
  // Stage 2: the staff AI's storyboard (kept in the voice-timing bucket) and what Logan sees to confirm it.
  storyboard: z.object({ path: z.string(), scenes: z.number().int().positive(), model: z.string(), at: z.string().datetime(),
    metaphors: z.array(z.object({ scene: z.number().int(), type: z.string(), at: z.string() }).strict()),
    cta: z.array(z.object({ after: z.string(), line: z.string() }).strict()),
    summary: z.object({ title: z.string(), points: z.array(z.string()) }).strict().nullable(),
    reasons: z.object({ metaphors: z.string(), cta: z.string(), summary: z.string() }).strict(),
    assets: z.array(z.object({ kind: z.enum(["people", "situations", "bgm"]), file: z.string(), url: z.string(), source: z.string(), license: z.string(), use: z.string() }).strict()),
    fuzzy: z.array(z.string()), notes: z.array(z.string()), reading: z.array(z.string()).optional(),
    // 고친 원고 (요청 3번, 2026-11-17): lent by the video's earlier run — how many paragraphs the edit changed, how many scenes went to the AI.
    carried: z.object({ changed: z.number().int().min(0), scenes: z.number().int().min(0) }).strict().optional() }).strict().optional(),
  // scenes: 점검 시트 장면 의견 (직원 요청 11-12) — the scenes the note names, so the staff AI changes only those in the storyboard it is given.
  review: z.object({ decision: z.enum(["confirmed", "revise"]), by: z.string().uuid(), name: z.string(), note: z.string(), at: z.string().datetime(),
    scenes: z.array(z.object({ n: z.number().int().positive(), at: z.string(), type: z.string(), who: z.string(), text: z.string() }).strict()).max(20).optional() }).strict().optional(),
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
  // storyboardPath: the storyboard file the sheets show, kept once a 장면 수정안 changes the storyboard under them (직원 요청 11-12).
  // 점검 시트 (직원 요청 11-13): cells = each cell's storyboard number (sheets drawn by tools/myin_redraw.py; his preview() numbered his
  // own scenes, and an opening's acts are several); after 바뀐 장면만 다시 그리기 the sheets show storyAt, drawn = what that drawing did,
  // redraw = one waiting for (or on) the computer that holds the video's folder.
  prepared: z.object({ path: z.string(), misses: z.array(z.string()), sheets: z.array(z.string()), credits: z.array(z.string()), at: z.string().datetime(), used: materialsSchema.optional(), engine: engineFp.optional(),
    storyboardPath: z.string().optional(), cells: z.array(z.number().int().min(1).max(400)).max(600).optional(), storyAt: z.string().max(40).optional(),
    /** 우리 이미지 nobody uploaded, drawn as a gray 「사진 자리」 at ④ (로건 11-13): the video goes on and names them as 바꿀 사진. */ standIns: z.array(z.string().max(200)).max(60).optional(),
    /** 렌더 전 관문 lines still there after MYIN_GATE_ROUNDS fixes: shown on the editor as 「여기서 사람 확인 필요」 (로건 11-13). */ needsPerson: z.array(z.string().max(300)).max(60).optional(),
    drawn: z.object({ at: z.string().datetime(), scenes: z.array(z.number().int().min(1).max(400)).max(600), lines: z.array(z.string().max(300)).max(60) }).strict().optional(),
    redraw: z.object({ state: z.enum(["pending", "drawing", "failed"]), at: z.string().datetime(), attempts: z.number().int().min(0).max(20), token: z.string().uuid().optional(),
      expiresAt: z.string().datetime().optional(), storyboardAt: z.string().max(40).optional(), path: z.string().optional(), code: z.string().max(80).optional() }).strict().optional(),
    /** 바뀐 장면만 (요청 3번): scenes whose cells came from the sheets of `from` ([now, then] storyboard numbers); its screen check carries them. */
    kept: z.array(z.tuple([z.number().int().min(1).max(400), z.number().int().min(1).max(400)])).max(600).optional(),
    from: z.object({ runId: z.string().uuid(), at: z.string().datetime() }).strict().optional(),
    /** Photo files the render PC drew as a gray 「사진 자리」 (it could not fetch them); a later preparation draws their scenes again. */
    photosMissing: z.array(z.string().max(200)).max(200).optional() }).strict().optional(),
  // 바뀐 장면만 (요청 3번, 2026-11-17): the sheets this video had before a new ③ (this run's before a voice fix or the 렌더 전 관문's
  // round, or the earlier run that lent its storyboard) — the next ③ draws and checks only the scenes that differ from them.
  lastPrep: z.object({ runId: z.string().uuid(), at: z.string().datetime(), engine: engineFp, sheets: z.array(z.string()).min(1).max(60), storyboardPath: z.string(),
    lines: z.array(z.string()).max(60),
    /** Where each photo file came from then (our upload or a listed photo's address) and those drawn as 「사진 자리」 (④ 이어 쓰기, 2026-11-17). */
    photos: z.record(z.string().max(200), z.string().max(2000)).optional(), missing: z.array(z.string().max(200)).max(200).optional() }).strict().optional(),
  // Stage 4: Logan's 720p clips (opening + reel, each metaphor), his OK, then the full render, mix and handouts.
  clips: z.object({ items: z.array(z.object({ name: z.string(), label: z.string(), path: z.string() }).strict()), at: z.string().datetime(), used: materialsSchema.optional(),
    engine: engineFp.optional() }).strict().optional(),
  clipsReview: z.object({ by: z.string().uuid(), name: z.string(), note: z.string(), at: z.string().datetime() }).strict().optional(),
  // 장면 그림 (편집기 3차 요청, 2026-11-09): a longform's ③ drawn as each scene's finished look (no clips), put on the editor screen as its
  // first version v0; the moving video is made once, at 「완성」 (④ · ⑤ without a stop).
  stills: z.object({ at: z.string().datetime(), files: z.number().int().min(1), bytes: z.number().int().min(0), used: materialsSchema.optional(), engine: engineFp.optional() }).strict().optional(),
  // GPT 화면 검사 끄기 (편집기 3차 요청 11-09: 급할 땐 끄고 바로 편집으로): new 점검 시트 are not sent to GPT by themselves; [검사하기] still is.
  screenCheckOff: z.literal(true).optional(),
  // 내 컴퓨터로 시안 (owner decision 2026-10-27): ③'s preparation and clips run on this member's own Mac (same engine as the render
  // PC, checked by fingerprint) instead of the render PC.
  local: z.object({ by: z.string().uuid(), name: z.string(), at: z.string().datetime() }).strict().optional(),
  // 직원 요청 2026-11-03: ④ 자료 준비 and the full video on a member's own computer too — both, since the video is drawn from the folder
  // the preparation filled. The render PC still makes the 구독 대사 voice (the Fish key and Logan's voice tools live only there).
  localFinish: z.object({ by: z.string().uuid(), name: z.string(), at: z.string().datetime() }).strict().optional(),
  // 제작 설정 (직원 요청 2026-11-05): where every later step is made and whether GPT checks the screens, chosen once when the video starts
  // (or changed later) instead of at each step. 「내 컴퓨터」 is the computer of whoever chose it.
  // 로건 11-13 (대표 11-16 「자동」): whether the storyboard waits for a person's 확인 or goes on by itself once the OS check passes (기본 자동, 롱폼).
  settings: z.object({ place: z.enum(["pc", "local"]), screenCheck: z.boolean(), confirm: z.enum(["auto", "person"]).optional(), by: z.string().uuid(), name: z.string(), at: z.string().datetime() }).strict().optional(),
  // 로건 11-13: the paid steps (voice, 구독 대사 voice) approved once by a person when the video starts — 「완성」 then asks no more.
  paidOk: z.object({ by: z.string().uuid(), name: z.string(), at: z.string().datetime() }).strict().optional(),
  // 렌더 전 관문 sends at ③ in a row (a person's 수정 요청 resets it); past MYIN_GATE_ROUNDS the video goes on and marks them 사람 확인 필요.
  gateRounds: z.number().int().min(0).max(50).optional(),
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
  // 렌더 PC 여러 대 (2026-11-08): the render PC holding this video's work folder (voice, then ④ files), named by its first claim.
  pc: z.string().regex(RENDER_PC_NAME).optional(),
  // The full video was asked for when its PC went away: after ④ preparation on the next PC it starts without another press.
  resumeFinal: z.literal(true).optional(),
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
  const { layout, renderer, headCopy = "", screenScript = "", recycle } = input as { layout?: "short"; renderer?: "web"; headCopy?: string; screenScript?: string;
    recycle?: { projectId: string; runId: string; cuts: [number, number][] } };
  if (!plan.inputKey || !plan.script || !scriptText) throw new ApiError(409, "AUTOMATION_INPUT_CHANGED", "승인된 원고와 패키징을 먼저 확인해 주세요.");
  const script = state.records.find((record) => record.id === plan.script?.id);
  const manuscript = typeof script?.metadata.manuscript === "string" ? script.metadata.manuscript : null;
  const markdown = myinScriptMarkdown(manuscript, scriptText);
  const { spoken } = myinCleanScript(markdown);
  if (!spoken.length) throw new ApiError(409, "MYIN_SCRIPT_EMPTY", "읽을 문단이 없는 원고입니다.");
  return { state, inputKey: plan.inputKey, script: plan.script, markdown, spoken, title, layout, renderer, headCopy, screenScript, recycle };
}

async function save(service: Service, record: OsRecord, status: string, stage: string, run: MyinRun) {
  const { data, error } = await service.from("os_records").update({ status, stage, metadata: run, updated_by: record.owner_id })
    .eq("id", record.id).eq("version", record.version).eq("record_type", "ai_job").is("archived_at", null).select("*").maybeSingle();
  if (error || !data) throw new ApiError(409, "MYIN_RUN_CHANGED", "v13 작업이 먼저 변경됐습니다.");
  return data as OsRecord;
}

export function presentMyinRun(record: OsRecord) {
  const run = parse(record);
  return { id: record.id, status: record.status, stage: record.stage, layout: run.layout ?? null, renderer: run.renderer ?? null, paragraphs: run.paragraphs.length,
    paragraphsReady: run.paragraphs.filter((p) => p.status === "ready").length, voiceOnPc: Boolean(run.voiceOn), words: run.words ?? null,
    storyboard: run.storyboard ? { ...run.storyboard, path: undefined } : null, review: run.review ?? null,
    assetDecisions: Object.fromEntries(Object.entries(run.assets ?? {}).map(([file, value]) => [file, { decision: value.decision }])),
    ctaReady: run.cta ? `${run.cta.filter((c) => c.status === "ready").length}/${run.cta.length}` : null,
    prepared: run.prepared ? { misses: run.prepared.misses, sheets: run.prepared.sheets.length, credits: run.prepared.credits, at: run.prepared.at,
      redraw: run.prepared.redraw?.state ?? null, redrawnAt: run.prepared.drawn?.at ?? null, standIns: (run.prepared.standIns ?? []).filter((file) => !run.ours?.[file]),
      needsPerson: run.prepared.needsPerson ?? [] } : null,
    clips: run.clips ? run.clips.items.map(({ name, label }) => ({ name, label })) : null, clipsReview: run.clipsReview ?? null, sound: run.sound ?? null,
    stills: run.stills ? { at: run.stills.at, files: run.stills.files } : null, screenCheckAuto: !run.screenCheckOff,
    final: run.final ? { bytes: run.final.bytes, durationSeconds: run.final.durationSeconds, lufs: run.final.lufs, peak: run.final.peak, at: run.final.at, sizes: Boolean(run.final.sizes) } : null,
    feedSizes: Boolean(run.feedSizes),
    voiceFixes: (run.voiceFixes ?? []).map(({ memo, say, read, name }) => ({ memo, say: say ?? null, read: read ?? null, name })), voiceCheck: run.voiceCheck ?? null,
    voiceFixable: voiceFixable(record, run), voiceChanged: run.voiceChanged ?? null, subtitleEdits: run.subtitleEdits ? run.subtitleEdits.lines.length : 0,
    style: run.style ? { id: run.style.id, name: run.style.name, version: run.style.version, channel: run.style.channel } : null,
    lastErrorCode: run.lastError?.code ?? null, waitingPhotos: (run.lastError?.files ?? []).filter((file) => !run.ours?.[file]), createdAt: record.created_at, local: run.local ? { by: run.local.by, name: run.local.name } : null,
    localFinish: run.localFinish ? { by: run.localFinish.by, name: run.localFinish.name } : null, clipsStale: previewStale(run),
    settings: run.settings ? { place: run.settings.place, screenCheck: run.settings.screenCheck, confirm: run.settings.confirm ?? "auto", name: run.settings.name } : null,
    autoConfirm: autoConfirms(run), paidOk: Boolean(run.paidOk), gateRounds: run.gateRounds ?? 0,
    photoCredits: Object.fromEntries(Object.entries(run.ours ?? {}).map(([file, image]) => [file, image.credit ? { source: image.credit.source, license: image.credit.license, url: image.credit.url }
      : { source: `우리 이미지 · ${image.name}`, license: "", url: null }])), localReady: Boolean(run.words?.voice) && !run.layout,
    // 로건 피드백 10/26-8: when the render PC took this step, so the screen can say how long it has been working.
    workingSince: record.status === "in_progress" ? run.lease?.startedAt ?? null : null, pc: run.pc ?? null };
}

/**
 * The latest v13 run for one video, with the frozen transcription (words, speech) once it exists. An admin starts the run (Fish
 * cost) and the content owner's AI writes its storyboard, so the run is found by video, not by who started it.
 * An edit order needs only this: it changes a video already made, also once 최종 검토 moved the video on to 업로드 (staff test 11-06).
 */
export async function myinRunWords(service: Service, sourceId: string) {
  const { data } = await service.from("os_records").select("*").eq("parent_id", sourceId).eq("record_type", "ai_job")
    .eq("metadata->>kind", MYIN_RUN_KIND).is("archived_at", null).order("created_at", { ascending: false }).limit(1);
  const record = data?.[0] as OsRecord | undefined;
  if (!record) throw new ApiError(409, "MYIN_RUN_REQUIRED", "먼저 v13 음성과 받아쓰기·자막을 만들어 주세요.");
  const run = parse(record);
  if (!run.words) throw new ApiError(409, "MYIN_WORDS_NOT_READY", "받아쓰기·자막이 끝난 뒤에 기획표를 쓸 수 있습니다.");
  const { data: file } = await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).download(run.words.path);
  if (!file) throw new ApiError(409, "MYIN_BUNDLE_MISSING", "받아쓰기 결과 파일을 찾지 못했습니다.");
  const bundle = JSON.parse(await file.text()) as { words: [number, number, string][]; speech: string };
  return { record, run, words: bundle.words, speech: bundle.speech ?? "" };
}
/** The run with words and the approved script it reads, for writing its storyboard (only while the script can be read: 제작 · 최종 검토). */
export async function myinRunWithWords(service: Service, sourceId: string) {
  const myin = await myinRunWords(service, sourceId);
  const input = await currentInput(service, sourceId);
  return { ...myin, markdown: input.markdown, title: input.title, headCopy: input.headCopy, screenScript: input.screenScript };
}

/** A storyboard the OS checked goes to Logan: kept as a file, summarised for the ③ panel. */
type StoryboardValue = {
  storyboard: Record<string, unknown>; assets: NonNullable<MyinRun["storyboard"]>["assets"]; reasons: NonNullable<MyinRun["storyboard"]>["reasons"];
  fuzzy: string[]; notes: string[]; model: string; reading?: string[]; carried?: NonNullable<MyinRun["storyboard"]>["carried"];
};
const storyboardEntry = (path: string, value: StoryboardValue): NonNullable<MyinRun["storyboard"]> => ({ path, ...storyboardFields(value.storyboard), model: value.model,
  at: new Date().toISOString(), reasons: value.reasons, assets: value.assets, fuzzy: value.fuzzy.slice(0, 60), notes: value.notes,
  ...(value.reading?.length ? { reading: value.reading.slice(0, 40) } : {}), ...(value.carried ? { carried: value.carried } : {}) });
export async function saveMyinStoryboard(service: Service, record: OsRecord, run: MyinRun, value: StoryboardValue) {
  // The AI that fixed the scenes an edit took away keeps the line that the rest is the earlier run's.
  const carried = value.carried ?? (run.review?.name === MYIN_CARRY_NAME ? run.storyboard?.carried : undefined);
  const next: MyinRun = { ...run, storyboard: storyboardEntry(await storyboardFile(service, record, run, value.storyboard), { ...value, carried }) };
  delete next.review;
  const saved = await save(service, record, "backlog", "storyboard_review", next);
  return autoConfirms(next) ? confirmByItself(service, saved).catch((error) => {
    console.error(JSON.stringify({ event: "storyboard_auto_confirm_failed", runId: record.id, message: error instanceof Error ? error.message : String(error) }));
    return saved;
  }) : saved;
}

/** Who confirms a storyboard that went on by itself (the panel and the news name it in place of a person). */
export const MYIN_AUTO_CONFIRM_NAME = "자동 확인";
/** 렌더 전 관문 rounds before the video goes on with what is left marked 사람 확인 필요 (로건 11-13: 「3번 넘게 반복되면」). */
export const MYIN_GATE_ROUNDS = 3;
/**
 * 기획표 확인 「자동」 (대표 11-16, 기본): a 롱폼 whose 제작 설정 does not ask for a person. A 숏폼 keeps its 확인, except one cut from a
 * longform (대표 11-21: its people look once, at the preview, on 「한눈에 확인」).
 */
export const autoConfirms = (run: Pick<MyinRun, "layout" | "settings" | "recycle">) => (!run.layout || Boolean(run.recycle)) && run.settings?.confirm !== "person";

/**
 * 기획표 확인 「자동」: the storyboard the OS check passed is confirmed as a person's 확인 would be — placed by the 제작 설정 and ③ starts.
 * A changed 원고 or a 「내 컴퓨터」 that cannot make this video leaves it at 확인 대기 for a person.
 */
async function confirmByItself(service: Service, record: OsRecord) {
  const run = parse(record);
  await assertCurrent(service, run);
  const by = run.settings?.by ?? record.owner_id ?? record.created_by ?? "";
  const next: MyinRun = { ...run, review: { decision: "confirmed", by, name: MYIN_AUTO_CONFIRM_NAME, note: "", at: new Date().toISOString() } };
  placeStep(next, { ownerId: by, name: run.settings?.name ?? "" } as RequestActor);
  if (run.settings?.screenCheck ?? true) delete next.screenCheckOff; else next.screenCheckOff = true;
  const saved = await save(service, record, "done", "storyboard_confirmed", next);
  return beginDraft(service, saved, parse(saved));
}
/** What the ③ panel shows of a storyboard: its scene count, metaphor scenes, 구독 대사 and 한 장 정리. */
const WEB_SHORT_CARD_TYPES = new Set(["react", "messenger", "list", "compare", "clock", "endcard"]);
function storyboardFields(storyboard: Record<string, unknown>) {
  const scenes = storyboard.scenes as { type: string; at?: string; title?: unknown; points?: { h?: string }[] }[];
  const metaphorTypes = new Set(MYIN_METAPHOR_TYPES);
  const summary = scenes.find((sc) => sc.type === "summary");
  // 웹 숏폼: its 도식 · 카드 (변신 도식 B, 카드 D) are the templates that draw on a white card over the photo.
  const drawn = storyboard.renderer === "web" ? (type: string) => WEB_SHORT_CARD_TYPES.has(type) : (type: string) => metaphorTypes.has(type) || type.startsWith("lib_");
  return { scenes: scenes.length, metaphors: scenes.flatMap((sc, i) => drawn(sc.type) ? [{ scene: i + 1, type: sc.type, at: String(sc.at ?? "") }] : []),
    cta: ((storyboard.cta ?? []) as { after: string; line: string }[]).map(({ after, line }) => ({ after, line })),
    summary: summary ? { title: typeof summary.title === "string" ? summary.title : JSON.stringify(summary.title ?? ""), points: (summary.points ?? []).map((p) => String(p.h ?? "")) } : null };
}

/** Logan (연출자) confirms the storyboard, or sends it back with a note for the staff AI's next pass. */
export async function reviewMyinStoryboard(actor: RequestActor, runId: string, decision: "confirmed" | "revise", note: string, place?: "pc" | "local", screenCheck?: boolean,
  scenes?: NonNullable<MyinRun["review"]>["scenes"]) {
  const service = createServiceSupabase();
  const { record, run } = await visibleRun(actor, runId);
  // Confirm from review; a change of mind (revise) is still possible after confirming, until the preview clips start.
  const open = decision === "confirmed" ? ["storyboard_review"] : ["storyboard_review", "storyboard_confirmed", "cta_pending", "prep_pending", "prep_ready", "clips_pending", "clips_review"];
  if (!open.includes(record.stage ?? "") || !run.storyboard) throw new ApiError(409, "MYIN_NOT_IN_REVIEW", "확인을 기다리는 기획표가 없습니다.");
  if (decision === "revise" && !note.trim()) throw new ApiError(400, "MYIN_REVIEW_NOTE_REQUIRED", "무엇을 고칠지 한 줄 적어 주세요.");
  if (decision === "confirmed") await assertCurrent(service, run);
  const next: MyinRun = { ...run, review: { decision, by: actor.id, name: actor.name, note: note.trim().slice(0, 2000), at: new Date().toISOString(), ...(decision === "revise" && scenes?.length ? { scenes } : {}) } };
  if (decision === "confirmed") { placeStep(next, actor, place); if (screenCheck ?? run.settings?.screenCheck ?? true) delete next.screenCheckOff; else next.screenCheckOff = true; }
  if (decision === "revise") {
    delete next.prepared; delete next.clips; delete next.stills; delete next.clipsReview; delete next.sound; delete next.lease; delete next.gateRounds;
    const back = await save(service, record, "backlog", "words_ready", next);
    if (run.recycle) await resendStoryboard(run.sourceId, record.id, undefined, gptStoryboardFor(run, record));
    return presentMyinRun(back);
  }
  // 2026-10-27 대표: 시안(도식·글자)을 먼저 본다. 사진 허락과 구독 대사 음성은 시안 확인 뒤 ④ 자료 준비에서(2026-10-19의 「확인 = 사진 허락」을 옮김).
  const saved = await save(service, record, "done", "storyboard_confirmed", next);
  return presentMyinRun(await beginDraft(service, saved, parse(saved)));
}

/** ③ drafts go to `local`, ④ with the full video (once the drafts are confirmed) to `localFinish`. */
function draftPlace(run: MyinRun, who: { ownerId: string; name: string }, place: "pc" | "local") {
  const field = run.clipsReview ? "localFinish" : "local";
  if (place === "local") { assertLocalReady(run); run[field] = { by: who.ownerId, name: who.name, at: new Date().toISOString() }; }
  else delete run[field];
}

/** A confirm places the next step as asked, else by the 제작 설정 — on the chooser's computer, or the render PC where a staff computer cannot make this video. */
function placeStep(run: MyinRun, actor: RequestActor, place?: "pc" | "local") {
  if (place) return draftPlace(run, actor, place);
  const settings = run.settings;
  draftPlace(run, settings ? { ownerId: settings.by, name: settings.name } : actor, settingsPlace(settings, run));
}

/** 제작 설정 바꾸기: steps that start after this follow the new choice; a step already waiting is moved with 만드는 곳 buttons. */
export async function setMyinSettings(actor: RequestActor, runId: string, choice: { place: "pc" | "local"; screenCheck: boolean; confirm?: "auto" | "person" }) {
  const service = createServiceSupabase();
  const { record, run } = await visibleRun(actor, runId);
  if (run.final && record.stage === "final_ready") throw new ApiError(409, "MYIN_SETTINGS_DONE", "완성된 영상이에요. 다시 만들 때 바꿔 주세요.");
  const next: MyinRun = { ...run, settings: { ...choice, by: actor.ownerId, name: actor.name, at: new Date().toISOString() } };
  return presentMyinRun(await save(service, record, record.status, record.stage!, next));
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
/**
 * 원고를 고쳐 다시 누른 영상 (로건 11-16): a newer run of the same video exists, so the render PC stops this one. The render PC kept
 * making the old script's voice for an hour while the new one waited behind it.
 */
export async function myinRunReplaced(runId: string, service: Service = createServiceSupabase()) {
  const { data: run } = await service.from("os_records").select("parent_id, created_at").eq("id", runId).eq("record_type", "ai_job").maybeSingle();
  if (!run?.parent_id) return false;
  const { data } = await service.from("os_records").select("id").eq("parent_id", run.parent_id).eq("record_type", "ai_job").eq("metadata->>kind", MYIN_RUN_KIND)
    .is("archived_at", null).gt("created_at", run.created_at).limit(1);
  return Boolean(data?.length);
}

/**
 * 고친 문장만 다시 (2026-11-16): earlier runs of the video whose voice the render PC may borrow paragraphs from — made there,
 * finished (words), with the same voice — newest first. The PC that has one of their folders reuses each paragraph whose text is unchanged.
 */
async function voiceDonors(service: Service, sourceId: string, like: Pick<MyinRun, "voiceReferenceFingerprint" | "voiceModel" | "layout">, before?: string) {
  let query = service.from("os_records").select("id, metadata").eq("parent_id", sourceId).eq("record_type", "ai_job").eq("metadata->>kind", MYIN_RUN_KIND)
    .is("archived_at", null);
  if (before) query = query.lt("created_at", before);
  const { data } = await query.order("created_at", { ascending: false }).limit(10);
  return ((data ?? []) as { id: string; metadata: MyinRun }[]).filter(({ metadata: m }) => m.voiceOn && m.words && m.voiceModel === like.voiceModel
    && m.voiceReferenceFingerprint === like.voiceReferenceFingerprint && (m.layout ?? null) === (like.layout ?? null)).slice(0, 3);
}
// 대기 순서 (로건 요청 94ba5545, 2026-11-17): the render PC makes one voice at a time and a new video's takes an hour, so a voice that
// waits says what the PC is on and how many voices are ahead. Minutes as the panel's: 1.4 a paragraph made (two at a time, 11-13), the
// paragraphs an earlier voice of the video has are kept (#606), words and the check of kept paragraphs take a minute or two (#612).
const VOICE_FIXED_MIN = 3, VOICE_PARAGRAPH_MIN = 1.4;
/** A voice that waited this long before the render PC took it notifies (음성 시작 알림); a short wait is not worth a notice. */
const VOICE_START_NOTICE_MS = 10 * 60_000;
const RENDER_STAGE_MIN: Record<string, number> = { breath_pending: 5, cta_pending: 2, prep_pending: 5, clips_pending: 4 };

/** About how many minutes the render PC spends on a run's step now; a voice counts only the paragraphs it has to make. */
async function stageMinutes(service: Service, record: OsRecord, run: MyinRun) {
  if (record.stage === "final_pending") return Math.ceil((run.words?.durationSeconds ?? 780) / 60 * 5);
  if (record.stage !== "words_pending") return RENDER_STAGE_MIN[record.stage ?? ""] ?? 5;
  if (run.voiceFixes?.length) return VOICE_FIXED_MIN;
  const [donor] = run.layout ? [] : await voiceDonors(service, run.sourceId, run, record.created_at);
  const kept = new Set(donor?.metadata.paragraphs.map((p) => p.textHash) ?? []);
  return Math.ceil(VOICE_FIXED_MIN + VOICE_PARAGRAPH_MIN * run.paragraphs.filter((p) => !kept.has(p.textHash)).length);
}

/** A voice waiting for the render PC: what it is doing now (video, step, minutes left) and the voices ahead of this one, with a rough start. */
async function voiceQueue(service: Service, record: OsRecord) {
  if (record.status !== "backlog" || record.stage !== "words_pending") return null;
  const [pcs, { data }] = await Promise.all([renderPcJobs(), service.from("os_records").select("*").eq("record_type", "ai_job").eq("metadata->>kind", MYIN_RUN_KIND)
    .in("status", ["backlog", "in_progress"]).is("archived_at", null).order("created_at").limit(50)]);
  const rows = ((data ?? []) as OsRecord[]).flatMap((row) => { try { return [{ row, run: parse(row) }]; } catch { return []; } });
  const busy = pcs.find((pc) => pc.job && pc.job.runId !== record.id);
  const doing = busy?.job?.runId ? rows.find((item) => item.row.id === busy.job!.runId) : undefined;
  const since = doing?.run.lease?.startedAt;
  const left = doing ? Math.max(1, await stageMinutes(service, doing.row, doing.run) - (since ? Math.floor((Date.now() - Date.parse(since)) / 60_000) : 0)) : busy ? 10 : 0;
  const ahead = rows.filter((item) => item.row.id !== record.id && item.row.id !== doing?.row.id && item.row.stage === "words_pending" && item.row.status === "backlog"
    && item.row.created_at < record.created_at);
  const minutes = left + (await Promise.all(ahead.map((item) => stageMinutes(service, item.row, item.run)))).reduce((sum, value) => sum + value, 0);
  const titleOf = async (sourceId: string) => (await service.from("os_records").select("title").eq("id", sourceId).maybeSingle()).data?.title as string | undefined;
  return { pcOn: pcs.length > 0, ahead: ahead.length, minutes,
    now: busy ? { title: doing ? (await titleOf(doing.run.sourceId))?.slice(0, 80) ?? "" : "", stage: doing?.row.stage ?? busy.job?.step ?? "", left } : null };
}

/** Before 「바뀐 원고로 다시 만들기」: the paragraphs the newest earlier voice does not have, which are the ones Fish is paid for. */
async function voiceReuse(service: Service, sourceId: string, run: MyinRun) {
  if (!run.voiceOn || run.layout) return null;
  const [donor] = await voiceDonors(service, sourceId, run);
  if (!donor) return null;
  const kept = new Set(donor.metadata.paragraphs.map((p) => p.textHash));
  const { spoken } = await currentInput(service, sourceId);
  const make = spoken.filter((text) => !kept.has(sha(text)));
  return { keep: spoken.length - make.length, make: make.length, text: make.join("\n") };
}

/** 칼럼 롱폼 재료 (직원 요청 11-19): the newest longform run's storyboard photos and diagrams; null for a video without one. */
export async function columnMaterials(service: Service, sourceId: string) {
  const { data } = await service.from("os_records").select("metadata").eq("parent_id", sourceId).eq("record_type", "ai_job").eq("metadata->>kind", MYIN_RUN_KIND)
    .is("archived_at", null).order("created_at", { ascending: false }).limit(1);
  const run = data?.[0] ? parse(data[0] as Pick<OsRecord, "metadata">) : null;
  if (!run?.storyboard || run.layout) return null;
  const story = await storyboardJson(service, run).catch(() => null);
  return story ? myinColumnMaterials(story, run.storyboard.assets, run.ours ?? {}, (file) => run.assets?.[file]?.decision === "excluded") : null;
}

export async function latestMyinRun(actor: RequestActor, sourceId: string) {
  const { data } = await actor.supabase.from("os_records").select("*").eq("parent_id", sourceId).eq("record_type", "ai_job")
    .eq("metadata->>kind", MYIN_RUN_KIND).is("archived_at", null).order("created_at", { ascending: false }).limit(1);
  const record = data?.[0] as OsRecord | undefined;
  if (!record) return null;
  const changed = await scriptChanged(actor.supabase, parse(record));
  return { ...presentMyinRun(record), scriptChanged: changed, voiceQueue: await voiceQueue(createServiceSupabase(), record).catch(() => null),
    ...(changed ? { voiceReuse: await voiceReuse(createServiceSupabase(), sourceId, parse(record)).catch(() => null) } : {}),
    storyboardJob: record.stage === "words_ready" ? await storyboardJobNow(sourceId, actor.id).catch(() => null) : null };
}

/**
 * 로건 11-13 자동 흐름: the storyboard (first one or a 관문 fix) goes to someone's own AI by itself, so whoever opens the video sees whose
 * AI has it and where it is — not 「내 AI에 보내기」, which would ask their own AI for a second one.
 */
async function storyboardJobNow(sourceId: string, viewer: string) {
  const service = createServiceSupabase();
  const { data } = await service.from("os_records").select("owner_id,status,metadata").eq("record_type", "ai_job").eq("metadata->>kind", "youtube_staff_ai_v1")
    .eq("parent_id", sourceId).eq("metadata->>task", "storyboard").in("status", ["backlog", "active"]).is("archived_at", null).order("created_at", { ascending: false }).limit(1);
  const row = data?.[0] as { owner_id: string | null; status: string; metadata: { claimedAt?: string } } | undefined;
  if (!row?.owner_id) return null;
  const { data: profile } = await service.from("os_profiles").select("display_name").eq("id", row.owner_id).maybeSingle();
  return { name: String(profile?.display_name ?? ""), status: row.status, claimedAt: row.metadata?.claimedAt ?? null, mine: row.owner_id === viewer };
}

/**
 * 같은 대본 다른 채널 막기 (다채널 설계 §6-1): YouTube treats one video on several channels as repetitive content, so a script already
 * made into a video of one channel is not voiced for another. ponytail: the exact script only (its hash) — a lightly edited copy passes;
 * add a similarity check if such copies show up.
 */
async function assertOneChannel(sourceId: string, markdownHash: string, channel: ChannelStyle | undefined, cards: ChannelStyle[]) {
  if (cards.length < 2) return;
  const service = createServiceSupabase();
  const { data } = await service.from("os_records").select("parent_id").eq("record_type", "ai_job").eq("metadata->>kind", MYIN_RUN_KIND)
    .eq("metadata->>scriptMarkdownHash", markdownHash).neq("parent_id", sourceId).is("archived_at", null).limit(50);
  const others = [...new Set((data ?? []).map((row) => row.parent_id as string | null).filter((id): id is string => Boolean(id)))];
  if (!others.length) return;
  const { data: projects } = await service.from("os_records").select("metadata").in("id", others).is("archived_at", null);
  const clash = (projects ?? []).map((row) => channelOf(cards, (row.metadata?.yp as { topic?: { channel?: string } } | undefined)?.topic?.channel)).find((other) => other && other.id !== channel?.id);
  if (clash) throw new ApiError(409, "SCRIPT_ON_OTHER_CHANNEL", `같은 대본으로 「${clash.name}」 채널 영상을 이미 만들었어요. 채널마다 대본을 다르게 써 주세요.`);
}

/** The voice a run speaks with: its channel's, else the OS's own (every run made before channels). */
export const runVoice = (run?: { voiceReference?: string }) => run?.voiceReference || process.env.FISH_VOICE_REFERENCE_ID?.trim() || "";

/** [v13 음성 만들기]: any member who can read the video starts its one run for the approved script (owner decision 2026-10-20: no extra roles). */
/** The longform run a recycled 숏폼 cuts its voice from: it must still be there, transcribed, on a named render PC. */
async function recycleFrom(recycle: { runId: string; cuts: [number, number][] }) {
  const { data } = await createServiceSupabase().from("os_records").select("*").eq("id", recycle.runId).eq("record_type", "ai_job").is("archived_at", null).maybeSingle();
  const run = data ? parse(data as OsRecord) : null;
  if (!run?.words || !run.pc) throw new ApiError(409, "RECYCLE_NO_VOICE", "잘라 쓸 롱폼 음성이 영상 만드는 컴퓨터에 없어요. 롱폼의 [롱폼에서 뽑기]를 다시 해 주세요.");
  return { recycle: { from: recycle.runId, cuts: recycle.cuts }, pc: run.pc };
}

export async function createMyinRun(actor: RequestActor, sourceId: string, styleId?: string, settings?: { place: "pc" | "local"; screenCheck: boolean; confirm?: "auto" | "person" }, paidOk = false) {
  const input = await currentInput(actor.supabase, sourceId);
  const cards = (await readChannelStyles()).styles;
  const picked = styleId ? cards.find((style) => style.id === styleId) : undefined;
  if (styleId && !picked) throw new ApiError(400, "CHANNEL_STYLE_NOT_FOUND", "고른 채널 모양을 찾지 못했어요. 새로 불러와 주세요.");
  // A 원고 edited after 제작 started reaches the voice here. ponytail: length is left to the 구성안 → 제작 check (no runtime here).
  // A 숏폼's 대본 passed its own check (숏폼 대본 정본 §10) at 대본 확정 and cannot change after it.
  if (!input.layout) await assertSpokenScript(actor.supabase, input.markdown, null);
  const channel = channelOf(cards, (input.state.source.metadata?.yp as { topic?: { channel?: string } } | undefined)?.topic?.channel);
  const channelVoice = channel?.voice?.trim() || undefined;
  const voiceReference = runVoice({ voiceReference: channelVoice });
  if (!process.env.FISH_API_KEY?.trim() || !voiceReference) throw new ApiError(503, "VOICE_WORKER_NOT_CONFIGURED", "Fish Audio 연결을 확인해 주세요.");
  const fingerprint = digestVoiceValue(voiceReference);
  const markdownHash = sha(input.markdown);
  await assertOneChannel(sourceId, markdownHash, channel, cards);
  // The way the voice is made is part of the run: the same script voiced on the render PC is a new run (new voice), not the old one.
  // 롱폼에서 나온 숏폼: its voice is the longform's, on the render PC that made it — that PC takes the run from the start.
  const recycled = input.recycle ? await recycleFrom(input.recycle) : null;
  const onPc = myinVoiceOnRenderPc() || Boolean(recycled);
  const runKey = digestVoiceValue([MYIN_RUN_KIND, sourceId, input.inputKey, markdownHash, MYIN_VOICE_MODEL, fingerprint, JSON.stringify(MYIN_VOICE_TUNING), ...(onPc ? ["render_pc"] : [])]);
  const id = voiceRunId(runKey);
  const run: MyinRun = { kind: MYIN_RUN_KIND, runKey, sourceId, inputKey: input.inputKey, script: input.script, scriptMarkdownHash: markdownHash,
    voiceModel: MYIN_VOICE_MODEL, voiceReferenceFingerprint: fingerprint, ...(channelVoice ? { voiceReference: channelVoice } : {}), attempts: 0, ...(input.layout ? { layout: input.layout } : {}), ...(input.renderer ? { renderer: input.renderer } : {}), ...(onPc ? { voiceOn: "render_pc" as const } : {}),
    ...(picked ? { style: pinStyle(picked) } : {}), ...(recycled ? { recycle: recycled.recycle, pc: recycled.pc } : {}),
    ...(settings ? { settings: { ...settings, by: actor.ownerId, name: actor.name, at: new Date().toISOString() } } : {}),
    ...(paidOk && actor.type === "user" ? { paidOk: { by: actor.ownerId, name: actor.name, at: new Date().toISOString() } } : {}),
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

/** A render PC's claim (`pc`, its name; none from a worker that sends no name). A member's own computer passes none. */
interface PcClaim { name?: string }

async function claim(service: Service, stage: string, leaseMs: number | ((run: MyinRun) => number), accept: (run: MyinRun) => boolean = () => true, input?: (run: MyinRun) => string,
  engineOf?: (run: MyinRun) => Promise<string | undefined>, pc?: PcClaim) {
  const { data } = await service.from("os_records").select("*").eq("record_type", "ai_job").eq("metadata->>kind", MYIN_RUN_KIND)
    .eq("stage", stage).in("status", ["backlog", "in_progress"]).is("archived_at", null).order("created_at").limit(10);
  const gone = new Map<string, Promise<boolean>>();
  for (const candidate of (data ?? []) as OsRecord[]) {
    let run: MyinRun; try { run = parse(candidate); } catch { continue; }
    if (!accept(run)) continue;
    if (run.lease && Date.parse(run.lease.expiresAt) > Date.now()) continue;
    if (run.attempts >= 3) { await save(service, candidate, "blocked", stage, run).catch(() => null); continue; }
    // 렌더 PC 여러 대: a video waits for the PC with its work folder, and moves only when that PC has been off for half an hour.
    // ponytail: the oldest 10 of a stage are looked at, so 10 videos waiting for busy PCs hide an 11th; page if queues grow that long.
    if (pc && run.pc && pinnedElsewhere(run, pc.name)) {
      if (!gone.has(run.pc)) gone.set(run.pc, renderPcGone(run.pc));
      const move = movePinned(stage, run, await gone.get(run.pc)!);
      if (move === "prepare_again") await prepareAgain(service, candidate, run, stage);
      if (move !== "take") continue;
    }
    const engine = await engineOf?.(run);
    const lease = { token: randomUUID(), expiresAt: new Date(Date.now() + (typeof leaseMs === "function" ? leaseMs(run) : leaseMs)).toISOString(), startedAt: new Date().toISOString(), stage, ...(input ? { input: input(run) } : {}), ...(engine ? { engine } : {}) };
    const next: MyinRun = { ...run, lease, attempts: run.attempts + 1 };
    if (pc) { if (pc.name) next.pc = pc.name; else delete next.pc; }
    const claimed = await save(service, candidate, "in_progress", stage, next).catch(() => null);
    if (claimed) return { record: claimed, run: parse(claimed), lease, waitedSince: candidate.updated_at };
  }
  return null;
}

/** The video's files that ③ drafts and the full video need are on a PC that is gone: prepare them again on the next PC. */
async function prepareAgain(service: Service, record: OsRecord, run: MyinRun, stage: string) {
  const next: MyinRun = { ...run, attempts: 0, ...(stage === "final_pending" ? { resumeFinal: true as const } : {}) };
  delete next.pc; delete next.lease; delete next.lastError;
  await save(service, record, "backlog", "prep_pending", next).catch(() => null);
}

/** ④'s 우리 이미지 with nothing uploaded: drawn as 「사진 자리」 and shown as 바꿀 사진. */
const ourStandIns = (run: MyinRun, folders: Map<string, string[]>) => photoSources(run, folders).filter((photo) => photo.from === "none" && photo.file.startsWith("ours_")).map((photo) => photo.file);

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
    const voiceReference = runVoice(run);
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
  return { scriptMarkdown: input.markdown, paragraphs, fishVoice: fishVoice(run) };
}
export const fishVoice = (run?: { voiceReference?: string }) => ({ referenceId: runVoice(run), model: MYIN_VOICE_MODEL });

/** A 숏폼 run goes only to a render PC whose worker has the vertical engine (it says `short`); an older worker keeps taking longforms. */
const fits = (short: boolean) => (run: MyinRun) => short || !run.layout;

export async function claimMyinWords(service: Service = createServiceSupabase(), short = false, pc?: string) {
  const claimed = await claim(service, "words_pending", wordsLeaseMs, fits(short), undefined, undefined, { name: pc });
  if (!claimed) return { idle: true as const };
  const { record, run, lease } = claimed;
  // 음성 시작 알림 (2026-11-17): a voice that waited for the render PC (another video's voice, a final render) tells who started it.
  if (Date.now() - Date.parse(claimed.waitedSince) >= VOICE_START_NOTICE_MS)
    await notify([record.owner_id, run.paidOk?.by].filter((id): id is string => Boolean(id)), "yt_voice_start", run.sourceId, `voice-start:${record.id}:${lease.token}`)
      .catch(() => undefined);
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
    // 고친 문장만 다시: a fresh voice names the earlier runs whose unchanged paragraphs its render PC may reuse.
    const earlier = run.voiceOn && !run.words && !run.voiceFixes?.length ? (await voiceDonors(service, run.sourceId, run, record.created_at).catch(() => [])).map((d) => d.id) : [];
    return { runId: record.id, lease: lease.token, ...voice, bundleUploadUrl: upload.signedUrl, ...(voiceUploadUrls.length === MYIN_VOICE_PARTS ? { voiceUploadUrls } : {}),
      ...(earlier.length ? { earlier } : {}), ...(run.recycle ? { recycle: run.recycle } : {}),
      ...(preview ? { previewUploadUrl: preview.signedUrl } : {}), ...(run.layout ? { layout: run.layout } : {}), ...(run.renderer ? { renderer: run.renderer } : {}),
      ...(dictionary?.exists ? { dictionary: dictionaryFiles(dictionary.dictionary) } : {}),
      ...(run.voiceFixes?.length ? { fixes: run.voiceFixes.map(({ memo, say, read, video, take, pause }) => ({ memo, ...(say ? { say } : {}), ...(read ? { read } : {}), ...(video ? { video } : {}),
        ...(take ? { take } : {}), ...(pause ? { pause } : {}) })) } : {}) };
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
/** Back at 받아쓰기 끝 with no storyboard: it goes to the AI that wrote the last one (that file imports this one, so it loads here). */
// 로건 11-13 자동 흐름: with 확인 「자동」 the first storyboard too — asked of the AI of whoever started the video.
// 롱폼에서 나온 숏폼 (대표 11-21): GPT writes it, every time the run is back at 받아쓰기 끝 (first, 렌더 전 관문, 수정 요청).
const resendStoryboard = (sourceId: string, runId: string, first?: string, gptFor?: string) => (gptFor
  ? import("./youtube-gpt-jobs").then((module) => module.requestGptStoryboard(sourceId, gptFor))
  : import("./youtube-ai-jobs").then(async (module) => await module.resendStoryboard(sourceId) ?? (first ? module.requestFirstStoryboard(sourceId, first) : null)))
  .catch((error) => console.error(JSON.stringify({ event: "storyboard_resend_failed", runId, message: error instanceof Error ? error.message : String(error) })));
/** Whose GPT storyboard a recycled 숏폼's run asks for (none for any other run). */
const gptStoryboardFor = (run: MyinRun, record: OsRecord) => run.recycle ? run.settings?.by ?? record.owner_id ?? record.created_by ?? undefined : undefined;

/** Who sends an edited script's storyboard scenes to the AI (the panel and the AI card name it). */
export const MYIN_CARRY_NAME = "원고 고친 곳";
/** More scenes than this (or a problem that is not a scene's) and the AI writes the storyboard again, as before. */
const CARRY_SCENES_MAX = 20;

/**
 * 고친 원고로 다시 만든 영상 (요청 3번, 2026-11-17): the newest earlier run of the video with a storyboard lends it — cues are words, so
 * they are carried over the script to this voice's transcript (myinCuesAsScript, then the usual check) instead of an AI writing all
 * of it again (35 minutes of a member's AI for 99 scenes). The scenes whose words the edit took away go to the AI alone, with the
 * rest as it is. That run's subtitle edits (matched by the line's words) and the our-images its storyboard names come along.
 * Nothing to lend: null, and the AI writes the storyboard as before.
 */
async function earlierLoan(service: Service, record: OsRecord, run: MyinRun, bundle: { words: [number, number, string][]; speech: string; subtitlesAss: string }, spoken: string[]) {
  if (run.layout || run.storyboard || run.subtitleEdits) return null;
  const { data } = await service.from("os_records").select("*").eq("parent_id", run.sourceId).eq("record_type", "ai_job").eq("metadata->>kind", MYIN_RUN_KIND)
    .is("archived_at", null).lt("created_at", record.created_at).order("created_at", { ascending: false }).limit(6);
  const readable = (row: OsRecord) => { try { return parse(row); } catch { return null; } };
  const found = (data ?? []).map((row) => ({ id: (row as OsRecord).id, run: readable(row as OsRecord) })).find(({ run: r }) => r && !r.layout && r.storyboard && r.words);
  const donor = found?.run;
  if (!found || !donor?.storyboard || !donor.words) return null;
  const lines = subtitleLines(bundle.subtitlesAss), edits = new Map<number, { i: number; from: string; to: string }>();
  for (const edit of donor.subtitleEdits?.lines ?? []) {
    const line = lines.filter((l) => l.text === edit.from).sort((a, b) => Math.abs(a.i - edit.i) - Math.abs(b.i - edit.i))[0];
    if (line && !edits.has(line.i)) edits.set(line.i, { i: line.i, from: edit.from, to: edit.to });
  }
  const subtitleEdits = edits.size && donor.subtitleEdits ? { lines: [...edits.values()].sort((a, b) => a.i - b.i), at: new Date().toISOString(), by: donor.subtitleEdits.by, name: donor.subtitleEdits.name } : undefined;
  const kept = new Set(donor.paragraphs.map((p) => p.textHash));
  const changed = run.paragraphs.filter((p) => !kept.has(p.textHash));
  // ponytail: past half the paragraphs it is a new script, not an edit — the AI writes it again; a share from use if this misjudges.
  const [{ data: file }, catalog] = await Promise.all([service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).download(donor.words.path), readDiagramCatalog().catch(() => null)]);
  if (!file || changed.length * 2 > run.paragraphs.length) return subtitleEdits ? { subtitleEdits } : null;
  const earlier = JSON.parse(await file.text()) as { words: [number, number, string][]; speech?: string };
  const story = myinCuesAsScript(await storyboardJson(service, donor), earlier.words, earlier.speech ?? "") as Record<string, unknown>;
  const checked = checkMyinStory(story, bundle.words, diagramCatalogTypes(catalog), bundle.speech);
  const scenes = new Map<number, string[]>();
  for (const issue of checked.issues) {
    const n = Number(issue.match(/^\[장면 (\d+)\] /)?.[1]);
    if (!n) return subtitleEdits ? { subtitleEdits } : null;
    scenes.set(n, [...scenes.get(n) ?? [], issue.replace(/^\[장면 \d+\] /, "")]);
  }
  if (scenes.size > CARRY_SCENES_MAX) return subtitleEdits ? { subtitleEdits } : null;
  const files = myinReferencedFiles(checked.storyboard);
  const ours = Object.fromEntries(Object.entries(donor.ours ?? {}).filter(([file]) => files.has(file)));
  const changedText = spoken.filter((text) => !kept.has(sha(text))).map((text) => `「${text.slice(0, 80)}${text.length > 80 ? "…" : ""}」`).join(" ");
  const sceneList = checked.storyboard.scenes as Record<string, unknown>[];
  return { subtitleEdits, ours, changed: changed.length, story: checked, storyboard: donor.storyboard, sheets: prepRef(found.id, donor),
    scenes: [...scenes].map(([n, problems]) => ({ n, at: String(sceneList[n - 1]?.at ?? ""), type: String(sceneList[n - 1]?.type ?? ""), who: MYIN_CARRY_NAME,
      text: `원고를 고쳐 이 장면의 문구를 새 받아쓰기에서 못 찾았어요(${problems.join(" · ")}). 이 장면만 새 원고에 맞게 고쳐 주세요. 바뀐 문단: ${changedText}`.slice(0, 2000) })) };
}

/**
 * The loan taken: the whole storyboard as a new storyboard (confirmed by itself under 「자동」, as the AI's would be) — "whole"; or, with
 * scenes the edit took away, this storyboard kept on the run with those scenes as a 수정 요청 for the AI (점검 시트 장면 의견) — "scenes".
 */
async function lendStoryboard(service: Service, record: OsRecord, loan: NonNullable<Awaited<ReturnType<typeof earlierLoan>>>) {
  if (!loan.story || !loan.storyboard || !loan.scenes) return "none";
  // Its ③ draws only the scenes that differ from the earlier run's sheets (바뀐 장면만).
  const run: MyinRun = { ...parse(record), ...(loan.sheets ? { lastPrep: loan.sheets } : {}) };
  const value: StoryboardValue = { storyboard: loan.story.storyboard, assets: loan.storyboard.assets, reasons: loan.storyboard.reasons, fuzzy: loan.story.fuzzy,
    notes: loan.story.notes, reading: loan.story.reading, model: loan.storyboard.model, carried: { changed: loan.changed, scenes: loan.scenes.length } };
  if (!loan.scenes.length) { await saveMyinStoryboard(service, record, run, value); return "whole"; }
  const next: MyinRun = { ...run, storyboard: storyboardEntry(await storyboardFile(service, record, run, value.storyboard), value),
    review: { decision: "revise", by: run.settings?.by ?? record.owner_id ?? record.created_by ?? "", name: MYIN_CARRY_NAME, note: `원고를 고친 곳 ${loan.scenes.length}장면만 AI가 고쳐요`,
      at: new Date().toISOString(), scenes: loan.scenes } };
  await save(service, record, "done", "words_ready", next);
  return "scenes";
}

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
  // A fix asked from 최종 검토 returns to ④, where 「전체 영상 만들기」 makes the video again with the new voice; one asked at ③ draws ③ again
  // (the storyboard's cues are words, so it stays); one asked while the storyboard waits for its 확인 waits there again.
  const resume = run.voiceResume;
  const stage = resume === "draft" ? "storyboard_confirmed" : resume ?? "words_ready";
  if (run.voiceResume) next.voiceChanged = { at: new Date().toISOString(), count: run.voiceFixes?.length ?? 0 };
  // 고친 원고 (요청 3번): what the video's earlier run lends; when it cannot, the AI writes the storyboard as before.
  const failedLoan = (error: unknown) => {
    console.error(JSON.stringify({ event: "myin_storyboard_loan_failed", runId: record.id, message: error instanceof Error ? error.message : String(error) }));
    return null;
  };
  const loan = stage === "words_ready" ? await earlierLoan(service, record, run, bundle.data, spoken).catch(failedLoan) : null;
  if (loan?.subtitleEdits) next.subtitleEdits = loan.subtitleEdits;
  if (loan?.ours && Object.keys(loan.ours).length) next.ours = { ...loan.ours, ...next.ours };
  const saved = await save(service, record, "done", stage, next);
  if (resume === "draft") await beginDraft(service, saved, parse(saved)).catch((error) => console.error(JSON.stringify({ event: "myin_redraft_failed", runId: record.id,
    message: error instanceof Error ? error.message : String(error) })));
  if (stage === "words_ready" && (loan ? await lendStoryboard(service, saved, loan).catch(failedLoan) : null) !== "whole")
    await resendStoryboard(run.sourceId, record.id, autoConfirms(run) ? run.settings?.by ?? record.owner_id ?? undefined : undefined, gptStoryboardFor(run, record));
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
    await save(service, record, "done", run.voiceResume === "draft" ? "clips_review" : run.voiceResume ?? "words_ready", next);
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
  // 이음 (2026-11-17, 영상 피드백 71): sentences whose join the engine fixed (끝소리 잘림 · 앞 조각) are worth a listen too.
  const joins = (row: z.infer<typeof auditRow>) => z.array(z.string()).catch([]).parse((row as { 이음?: unknown }).이음).slice(0, 4);
  const listen = rows.success ? rows.data.filter((row) => row.점수 >= 0.8 || row.긴호흡 > 0 || joins(row).length).sort((a, b) => a.시각 - b.시각).slice(0, 80)
    .map((row) => ({ at: row.시각, p: row.문단, sentence: row.문장.slice(0, 300), issues: row.문제.slice(0, 6).map((issue) => issue.slice(0, 80)), score: row.점수, long: row.긴호흡, joins: joins(row) })) : null;
  // 요청 2번: every sentence, to pick another take or add a pause to any of them.
  const all = rows.success ? [...rows.data].sort((a, b) => a.시각 - b.시각).slice(0, 400).map((row) => ({ at: row.시각, p: row.문단, sentence: row.문장.slice(0, 300) })) : null;
  const asked = run.takes;
  const takes = asked ? { p: asked.p, text: asked.text, state: asked.state, code: asked.code ?? null,
    files: asked.state === "ready" ? await Promise.all((asked.files ?? []).map(async (file) => ({ name: file.name, current: file.current, url: await sign(service, YOUTUBE_VOICE_BUCKET, file.path) }))) : [] } : null;
  const fixes = z.array(z.object({ memo: z.string(), ok: z.boolean(), report: z.string() }).passthrough()).safeParse(bundle.fixes);
  return { sentences: rows.success ? rows.data.length : null, listen, all, takes, fixes: fixes.success ? fixes.data.map(({ memo, ok, report }) => ({ memo, ok, report })) : [],
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
export async function visibleRun(actor: RequestActor, runId: string) {
  const { data } = await actor.supabase.from("os_records").select("id").eq("id", runId).eq("record_type", "ai_job").is("archived_at", null).maybeSingle();
  if (!data) throw new ApiError(404, "MYIN_RUN_NOT_FOUND", "v13 작업을 찾지 못했습니다.");
  return runRecord(createServiceSupabase(), runId);
}
/** What a render job gets: drift pairs, and {text, cue} slots the AI wrote as plain words fixed from the 도식 창고 examples (one read per job). */
async function renderStory<T extends { scenes: Record<string, unknown>[] }>(story: T) {
  myinTextPairs(story, new Map(((await readDiagramCatalog())?.items ?? []).flatMap((item) => item.example ? [[item.type, item.example] as const] : [])));
  return myinDriftPairs(story);
}
export async function storyboardJson(service: Service, run: MyinRun) {
  const { data } = await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).download(run.storyboard?.path ?? "");
  if (!data) throw new ApiError(409, "MYIN_STORYBOARD_MISSING", "기획표 파일을 찾지 못했습니다.");
  return JSON.parse(await data.text()) as Record<string, unknown> & { scenes: Record<string, unknown>[]; cta: { line: string }[] };
}
/** The storyboard the ③ sheets were drawn from and its version (at): the one now, unless a 장면 수정안 changed it since (storyboardPath). */
export async function sheetsStory(service: Service, run: MyinRun) {
  const at = run.prepared?.storyAt || run.prepared?.used?.storyboard || run.storyboard?.at || "";
  const path = run.prepared?.storyboardPath ?? (at === run.storyboard?.at ? run.storyboard?.path : undefined);
  if (!path) throw new ApiError(409, "MYIN_SHEETS_STORY_MISSING", "점검 시트를 그린 기획표를 찾지 못했어요. 미리보기를 다시 만들어 주세요.");
  const story = await storyboardJson(service, { ...run, storyboard: { ...run.storyboard!, path } });
  return { ...story, at };
}

/**
 * 장면 수정안 반영 (직원 요청 11-12): the storyboard with a scene replaced, as a new version (new at) at the same stage. The ③ sheets
 * stay and keep showing the version they were drawn from; the preview reads as made from an older storyboard until it is made again.
 */
export async function saveMyinSceneEdit(service: Service, record: OsRecord, run: MyinRun, story: Record<string, unknown>) {
  const { path } = await putStoryboard(service, record, run, story);
  const kept = run.prepared && !run.prepared.storyboardPath && (run.prepared.used?.storyboard ?? run.storyboard?.at) === run.storyboard?.at
    ? { ...run.prepared, storyboardPath: run.storyboard!.path } : run.prepared;
  // 바뀐 장면만 다시 그리기 (직원 요청 11-13): the computer with the video's folder draws the changed scenes into the sheets. One already
  // drawing finishes and goes again (completeMyinRedraw sees the newer storyboard).
  const prepared = kept?.sheets.length && kept.redraw?.state !== "drawing" ? { ...kept, redraw: { state: "pending" as const, at: new Date().toISOString(), attempts: 0 } } : kept;
  const next: MyinRun = { ...run, ...(prepared ? { prepared } : {}), storyboard: { ...run.storyboard!, ...storyboardFields(story), path, at: new Date().toISOString() } };
  return save(service, record, record.status ?? "done", record.stage ?? "", next);
}

/** A changed storyboard (its sound only) as a new file — storage serves a replaced file's old bytes for a while. */
async function putStoryboard(service: Service, record: OsRecord, run: MyinRun, value: unknown) {
  return { ...run.storyboard!, path: await storyboardFile(service, record, run, value) };
}
async function storyboardFile(service: Service, record: OsRecord, run: MyinRun, value: unknown) {
  const path = `${record.owner_id}/${run.sourceId}/${record.id}/myin-storyboard-${Date.now().toString(36)}.json`;
  const { error } = await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).upload(path, Buffer.from(JSON.stringify(value)), { contentType: "application/json", upsert: true });
  if (error) throw new ApiError(502, "MYIN_STORYBOARD_UPLOAD_FAILED", "기획표를 저장하지 못했습니다.");
  return path;
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
  const before = prepRef(record.id, run);
  const next: MyinRun = { ...run, attempts: 0, ...(before ? { lastPrep: before } : {}) };
  delete next.prepared; delete next.lastError; delete next.clips; delete next.stills; delete next.clipsReview; delete next.sound; delete next.lease; retireFinal(next);
  return save(service, record, "backlog", "prep_pending", next);
}

/** 바뀐 장면만 (요청 3번, 2026-11-17): a run's sheets as a later ③ starts from them — ours (with cells), drawn from the storyboard the run
 *  still names (not one a 장면 수정안 redrew), with the engine that drew them. */
function prepRef(runId: string, run: MyinRun): MyinRun["lastPrep"] {
  const prepared = run.prepared;
  if (!prepared?.cells || !prepared.sheets.length || !prepared.engine || prepared.storyboardPath || !run.storyboard) return undefined;
  if ((prepared.used?.storyboard ?? run.storyboard.at) !== run.storyboard.at) return undefined;
  return { runId, at: prepared.at, engine: prepared.engine, sheets: prepared.sheets.slice(0, 60), storyboardPath: run.storyboard.path,
    lines: prepared.misses.filter((line) => /^\[장면 \d+\] (빈 화면|그리기 오류)/.test(line)).slice(0, 60),
    photos: photoKeys(run), missing: (prepared.photosMissing ?? []).slice(0, 200) };
}

/** Where each photo file comes from: our upload (its path) or the listed photo's address; one that changes is drawn again (④ 이어 쓰기). */
function photoKeys(run: MyinRun): Record<string, string> {
  return Object.fromEntries([...(run.storyboard?.assets ?? []).map((asset) => [asset.file, asset.url] as const),
    ...Object.entries(run.ours ?? {}).map(([file, image]) => [file, image.path] as const)].slice(0, 200));
}

/** The sheets a ③ starts from, as the render PC takes them: the storyboard they show, where to fetch them, their check's lines. */
async function priorSheets(service: Service, run: MyinRun, prior: NonNullable<MyinRun["lastPrep"]>) {
  const story = await storyboardJson(service, { ...run, storyboard: { ...run.storyboard!, path: prior.storyboardPath } });
  // A photo whose source changed since (our image uploaded or swapped) or that was a 「사진 자리」 then: its scenes are drawn again.
  const now = photoKeys(run), then = prior.photos;
  const redraw = then ? [...new Set([...Object.keys(now), ...Object.keys(then)])].filter((file) => now[file] !== then[file]) : Object.keys(now);
  return { storyboard: await renderStory(story), sheets: await Promise.all(prior.sheets.map((path) => sign(service, SHEET_BUCKET, path))), lines: prior.lines,
    redraw: [...new Set([...redraw, ...prior.missing ?? []])].slice(0, 200) };
}

/** GPT 화면 검사 on or off for this video's next 점검 시트 (11-09); the button in the card still checks by hand. */
export async function setMyinScreenCheck(actor: RequestActor, runId: string, on: boolean) {
  const { record, run } = await visibleRun(actor, runId);
  const next: MyinRun = { ...run };
  if (on) delete next.screenCheckOff; else next.screenCheckOff = true;
  return presentMyinRun(await save(createServiceSupabase(), record, record.status, record.stage ?? "", next));
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
  // A 웹 숏폼 storyboard has no 구독 대사 (and stories saved before 2026-11-19 carry no cta list at all).
  const cta: NonNullable<MyinRun["cta"]> = (story.cta ?? []).map((c, index) => {
    const kept = run.cta?.find((p) => p.index === index && p.textHash === sha(c.line));
    return kept && (kept.path || !run.localFinish) ? kept : { index, textHash: sha(c.line), status: run.voiceOn && !run.localFinish ? "ready" as const : "pending" as const };
  });
  // ④ 이어 쓰기 (2026-11-17): the sheets ③ (or the ④ before) drew; only scenes that differ or whose photo changed are drawn and checked again.
  const before = prepRef(record.id, run);
  const next: MyinRun = { ...run, assets, cta, attempts: 0, ...(before ? { lastPrep: before } : {}) }; delete next.prepared; delete next.lastError; delete next.lease;
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
export async function claimMyinCta(service: Service = createServiceSupabase(), short = false, pc?: string) {
  const claimed = await claim(service, "cta_pending", WORDS_LEASE_MS, (run) => Boolean(run.voiceOn) && fits(short)(run), undefined, undefined, { name: pc });
  if (!claimed) return { idle: true as const };
  const { record, run, lease } = claimed;
  try {
    const story = await storyboardJson(service, run);
    const lines = [];
    for (const c of run.cta ?? []) if (c.status === "pending") lines.push({ index: c.index, uploadUrl: await uploadUrl(service, YOUTUBE_VOICE_BUCKET, ctaPcPath(record, run, c)) });
    return { runId: record.id, lease: lease.token, ...(run.layout ? { layout: run.layout } : {}), ...(run.renderer ? { renderer: run.renderer } : {}), storyboard: await renderStory(story), fishVoice: fishVoice(run), lines,
      ...await seedFor(service, run) };
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
      const audio = await synthesizeFishWav(line, { apiKey: process.env.FISH_API_KEY ?? "", referenceId: runVoice(run), model: MYIN_VOICE_MODEL });
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
/** A render PC rebuilds the stage-1 folder it lacks (a video moved from a PC that went away); a PC that has it keeps it. */
const seedFor = async (service: Service, run: MyinRun) => run.words?.voice ? { seed: await localSeed(service, run) } : {};
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
  video: z.literal(true).optional(),
  // 요청 2번 (2026-11-17): another take of the sentence the voice already made, or more pause around it — the render PC, no Fish.
  take: takeFix.optional(), pause: pauseFix.optional() }).strict();
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

/** The stages the 음성 확인 panel may fix a sentence at, and where the video goes back to once the words are made again (none = stage 1). */
const VOICE_FIX_STAGES: Record<string, MyinRun["voiceResume"] | null> = { words_ready: null, storyboard_review: "storyboard_review", clips_review: "draft",
  prep_ready: "prep_ready", final_ready: "prep_ready" };

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
  // Memos at the same sentence go as one fix (made and paid once); two different 읽는 글 or 발음 for one sentence are settled first. A take
  // or a pause names its sentence itself and costs nothing, so it goes as it is.
  const direct = memos.filter((memo) => memo.take || memo.pause);
  const plan = planVoiceFix(memos.filter((memo) => !memo.take && !memo.pause), await voiceSentences(service, run));
  if (plan.conflicts.length) throw new ApiError(400, "MYIN_VOICE_FIX_CONFLICT", `같은 문장에 읽는 글이나 발음이 둘 이상이에요. 하나만 남겨 주세요: ${plan.conflicts[0].join(" / ").slice(0, 200)}`);
  const fixes = [...plan.fixes, ...direct];
  // 최종 검토's (video: true) once the full video exists, from ④ or after it; the 음성 확인 panel's from stage 1 on, wherever the video
  // waits for a person (요청 2번, 2026-11-17 — with 자동 확인 stage 1 lasts seconds, and the voice is heard on the editor screen).
  const video = fixes.some((fix) => fix.video);
  const resume = VOICE_FIX_STAGES[record.stage ?? ""];
  if (video ? !["final_ready", "prep_ready"].includes(record.stage ?? "") || !run.final : resume === undefined)
    throw new ApiError(409, "MYIN_VOICE_FIX_CLOSED", video ? "완성 영상이 나온 뒤에 최종 검토 피드백으로 음성을 고칠 수 있어요." : "지금 만드는 중이에요. 끝난 뒤에 고쳐 주세요.");
  // His voice_fix works on the sentence files the render PC's own voice leaves; a 숏폼's package does not have it yet.
  if (!run.words || !voiceFixable(record, run)) throw new ApiError(409, "MYIN_VOICE_FIX_UNAVAILABLE", "이 영상은 문장 하나만 다시 만들 수 없어요(10/30 16시 전에 시작한 영상 · 숏폼).");
  if (!fixes.length) throw new ApiError(400, "MYIN_VOICE_FIX_EMPTY", "고칠 곳 메모를 하나 이상 남겨 주세요.");
  const at = new Date().toISOString();
  const back = video ? "prep_ready" as const : resume;
  const next: MyinRun = { ...run, attempts: 0, voiceFixes: fixes.slice(0, 20).map((fix) => ({ ...fix, ...(video ? { video: true as const } : {}), by: actor.id, name: actor.name, at })),
    ...(back ? { voiceResume: back } : {}) };
  delete next.takes;
  if (!video) delete next.voiceCheck;
  return presentMyinRun(await save(service, record, "backlog", "words_pending", next));
}
// ── 테이크 고르기 (요청 2번, 2026-11-17): the takes the voice made for one sentence, put up by the render PC that has them, to pick one by ear ──
const TAKES_LEASE_MS = 5 * 60_000;
export const myinTakeFile = z.string().regex(/^p\d{2}_s\d{2}_\d{1,3}\.mp3$/);
const takesPath = (record: OsRecord, run: MyinRun, token: string, file: string) => `${record.owner_id}/${run.sourceId}/${record.id}/takes-${token}/${file}`;

/** 「다른 테이크 듣기」: free — the takes are files the voice already made. One sentence at a time (a new ask replaces the last). */
export async function requestMyinTakes(actor: RequestActor, runId: string, p: number, text: string) {
  const { record, run } = await visibleRun(actor, runId);
  if (!run.words || !voiceFixable(record, run) || VOICE_FIX_STAGES[record.stage ?? ""] === undefined)
    throw new ApiError(409, "MYIN_TAKES_CLOSED", "지금은 테이크를 들을 수 없어요. 만드는 중이면 끝난 뒤에 해 주세요.");
  if (p >= run.paragraphs.length) throw new ApiError(400, "MYIN_TAKES_SENTENCE", "없는 문단이에요.");
  const next: MyinRun = { ...run, takes: { p, text: text.slice(0, 300), state: "pending", at: new Date().toISOString(), attempts: 0 } };
  return presentMyinRun(await save(createServiceSupabase(), record, record.status ?? "done", record.stage ?? "", next));
}

/** Render PC: a sentence whose takes are asked for, on this PC (the one that made the voice keeps them). */
export async function claimMyinTakes(service: Service = createServiceSupabase(), pc?: string) {
  const { data } = await service.from("os_records").select("*").eq("record_type", "ai_job").eq("metadata->>kind", MYIN_RUN_KIND)
    .not("metadata->takes", "is", null).is("archived_at", null).order("updated_at").limit(10);
  for (const candidate of (data ?? []) as OsRecord[]) {
    let run: MyinRun; try { run = parse(candidate); } catch { continue; }
    const asked = run.takes;
    if (!asked || asked.state === "ready" || asked.state === "failed" || (asked.state === "listing" && Date.parse(asked.expiresAt ?? "") > Date.now())) continue;
    if (run.pc && run.pc !== pc) continue;
    const token = randomUUID();
    const takes = asked.attempts >= 3 ? { ...asked, state: "failed" as const, code: asked.code ?? "MYIN_TAKES_FAILED" }
      : { ...asked, state: "listing" as const, attempts: asked.attempts + 1, token, expiresAt: new Date(Date.now() + TAKES_LEASE_MS).toISOString() };
    const saved = await save(service, candidate, candidate.status ?? "done", candidate.stage ?? "", { ...run, takes }).catch(() => null);
    if (saved && takes.state === "listing") return { runId: candidate.id, lease: token, p: takes.p, text: takes.text };
  }
  return { idle: true as const };
}

const takesLease = async (service: Service, runId: string, token: string) => {
  const { record, run } = await runRecord(service, runId);
  const takes = run.takes;
  if (!takes || takes.state !== "listing" || takes.token !== token) throw new ApiError(409, "MYIN_LEASE_LOST", "테이크를 올리는 권한이 만료됐습니다.");
  return { record, run, takes };
};
export async function myinTakesUpload(input: { runId: string; lease: string; files: string[] }, service: Service = createServiceSupabase()) {
  const { record, run } = await takesLease(service, input.runId, input.lease);
  return { uploads: await Promise.all(input.files.map(async (file) => ({ name: file, url: await uploadUrl(service, YOUTUBE_VOICE_BUCKET, takesPath(record, run, input.lease, file)) }))) };
}
export async function completeMyinTakes(input: { runId: string; lease: string; takes: { name: string; file: string; current: boolean }[] }, service: Service = createServiceSupabase()) {
  const { record, run, takes } = await takesLease(service, input.runId, input.lease);
  const next: MyinRun = { ...run, takes: { p: takes.p, text: takes.text, state: "ready", at: takes.at, attempts: takes.attempts,
    files: input.takes.map(({ name, file, current }) => ({ name, path: takesPath(record, run, input.lease, file), current })) } };
  await save(service, record, record.status ?? "done", record.stage ?? "", next);
  return { runId: record.id, takes: input.takes.length };
}
export async function failMyinTakes(input: { runId: string; lease: string; code: string }, service: Service = createServiceSupabase()) {
  const { record, run, takes } = await takesLease(service, input.runId, input.lease);
  const code = input.code.replace(/[^A-Z0-9_]/g, "").slice(0, 60) || "MYIN_TAKES_FAILED";
  const next: MyinRun = { ...run, takes: { p: takes.p, text: takes.text, at: takes.at, attempts: takes.attempts, code, state: takes.attempts >= 3 || code === "MYIN_TAKES_UNAVAILABLE" ? "failed" : "pending" } };
  await save(service, record, record.status ?? "done", record.stage ?? "", next);
  return { runId: record.id, retry: next.takes!.state === "pending" };
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
const previewStale = (run: MyinRun) => { const made = run.clips ?? run.stills; return made ? changedSince(made.used, run)?.filter((name) => name !== "자막") ?? null : null; };

/**
 * The engine a ③/④ job is drawn with: the render PC's, which a member's own computer must also have to take the job (assertLocalEngine).
 * A 숏폼 is drawn by the vertical copy (MYIN_PKG_SHORT), which the fingerprint does not cover, so none is kept for it.
 */
const drawnWith = (run: MyinRun) => run.layout ? Promise.resolve(undefined) : renderPcEngine();

/** Render PC (or, with `owner`, that member's own Mac for a ③ draft): storyboard, approved files, CTA voice and where the sheets and report go. */
export async function claimMyinPrep(service: Service = createServiceSupabase(), owner?: string, short = false, pc?: string) {
  // A member's computer takes ④ only once every 구독 대사 line is a file it can use (it cannot make one).
  const claimed = await claim(service, "prep_pending", WORDS_LEASE_MS, (run) => placeFilter(owner)(run) && (!owner || Boolean(run.words?.voice)) && fits(short)(run)
    && (!owner || !run.clipsReview || (run.cta ?? []).every((c) => c.path)), materialsKey, drawnWith, owner ? undefined : { name: pc });
  if (!claimed) return { idle: true as const };
  const { record, run, lease } = claimed;
  try {
    const story = await storyboardJson(service, run);
    // ③ 시안 (no drafts confirmed yet): the storyboard's photos are fetched for the drafts too (대표 2026-10-27: the drafts are for judging
    // quality), not yet approved; no CTA voice (paid). A gray 「사진 자리」 stands in only where a photo cannot be fetched.
    const draft = !run.clipsReview;
    const folders = myinPhotoFolders(story);
    // 우리 이미지 (2026-11-03): an ours_ photo nobody uploaded stopped Logan's engine at ④ with FileNotFoundError, and then (until 11-16) the
    // OS stopped ④ by name. 로건 11-13: go on to the end with a gray 「사진 자리」 and name it as 바꿀 사진; uploading it prepares ④ again.
    const standIns = draft ? [] : ourStandIns(run, folders);
    const placeholders = [...folders].filter(([file]) => draft || standIns.includes(file)).flatMap(([file, kinds]) => kinds.map((kind) => ({ kind, file })));
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
    // 바뀐 장면만 (요청 3번): the sheets before, drawn by the same engine; without them (or when they cannot be read) every scene is drawn.
    const prior = run.lastPrep && run.lastPrep.engine === lease.engine ? run.lastPrep : undefined;
    const previous = prior ? await priorSheets(service, run, prior).catch(() => null) : null;
    return { runId: record.id, lease: lease.token, ...(run.layout ? { layout: run.layout } : {}), ...(run.renderer ? { renderer: run.renderer } : {}), draft, placeholders, ...(previous ? { previous } : {}), storyboard: await renderStory(story), assets, cta, ...(cta.some((c) => !c.url) ? { fishVoice: fishVoice(run) } : {}), siteCapture: story.scenes.some((sc) => sc.type === "site_ad"),
      sheetUploadUrls: sheetUploads, bundleUploadUrl: bundle.signedUrl, ...(owner ? { seed: await localSeed(service, run) } : await seedFor(service, run)), ...await subtitlesFor(service, run), ...styleFor(run) };
  } catch (error) {
    await failed(service, record, run, error instanceof ApiError ? error.code : "MYIN_PREP_CLAIM_FAILED");
    throw error;
  }
}

const drewWith = (run: MyinRun) => run.lease?.engine ? { engine: run.lease.engine } : {};

/** Who sends a storyboard back by itself (the panel names it instead of the people who review). */
export const MYIN_GATE_NAME = "렌더 전 관문";

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
    storyboard: z.record(z.unknown()).optional(), soundReport: z.string().optional(), cells: z.array(z.number().int().min(1).max(400)).max(600).nullish(),
    kept: z.array(z.tuple([z.number().int().min(1).max(400), z.number().int().min(1).max(400)])).max(600).optional(),
    missingPhotos: z.array(z.string().max(200)).max(200).optional() }).passthrough().parse(JSON.parse(await data.text()));
  const draft = !run.clipsReview;
  let { storyboard, sound } = run;
  if (draft && bundle.storyboard) {
    // ③: the render PC wrote Logan's music match (곡·앰비언스 키) into the storyboard; keep it only if nothing else changed.
    // Not kept is no stop: the drafts are made from our storyboard, with the music it has (2026-10-28 유쓰·로건).
    const at = new Date().toISOString();
    // Ours as the render PC got it (renderStory), so a fixed {text, cue} slot is no "other change" — keeping the match keeps the fix too.
    if (myinOnlySoundChanged(bundle.storyboard, await renderStory(await storyboardJson(service, run)))) {
      storyboard = await putStoryboard(service, record, run, bundle.storyboard);
      sound = { report: (bundle.soundReport ?? "").slice(0, 20_000), at };
    } else sound = { report: "자동 선곡을 쓰지 않았어요. 선곡 결과에서 음악 말고 다른 칸도 바뀌어 있었어요. 음악은 기획표에 적힌 대로 깔립니다.", at };
  }
  // A listed photo replaced by ours is not used, so not credited; a candidate photo kept as ours brings its own credit.
  const credits = [...(run.storyboard?.assets ?? []).filter((a) => run.assets?.[a.file]?.decision === "approved" && !run.ours?.[a.file]).map((a) => `${a.file} — ${a.source} · ${a.license} · ${a.url}`),
    ...Object.entries(run.ours ?? {}).flatMap(([file, image]) => image.credit ? [`${file} — ${image.credit.source} · ${image.credit.license} · ${image.credit.url}`] : []),
    ...bundle.musicCredits.slice(0, 30)];
  const next: MyinRun = { ...run, storyboard, sound, attempts: 0, prepared: { path: prepBundlePath(record, run, input.lease), misses: bundle.misses.slice(0, 60),
    sheets: Array.from({ length: bundle.sheets }, (_, i) => sheetPath(record, run, input.lease, i + 1)), credits, at: new Date().toISOString(), ...drewWith(run),
    ...(bundle.cells ? { cells: bundle.cells } : {}) } };
  if (!draft) { const standIns = ourStandIns(run, myinPhotoFolders(await storyboardJson(service, run))); if (standIns.length) next.prepared!.standIns = standIns.slice(0, 60); }
  next.prepared!.used = materials(next);
  if (bundle.kept?.length && run.lastPrep) { next.prepared!.kept = bundle.kept; next.prepared!.from = { runId: run.lastPrep.runId, at: run.lastPrep.at }; }
  if (bundle.missingPhotos?.length) next.prepared!.photosMissing = bundle.missingPhotos;
  delete next.lease; delete next.lastError; delete next.lastPrep;
  if (draft) { delete next.clips; delete next.stills; delete next.clipsReview; retireFinal(next); }
  if (!next.sound) delete next.sound;
  // 렌더 전 관문 (로건 개발 문서 v3 7.2-3): at ③ a phrase the engine cannot place or a blank scene goes straight back to the storyboard
  // as its 수정 요청 (the next staff-AI pass gets the list); ④ still stops for a person, who sees the same list.
  // 덱 배치 v2 (2026-11-10): the render PC also times each cut against the voice with the engine's scene times (늦게 바뀜 · 빈 화면 · N초 미만 장면).
  // 2026-11-17: a hold the engine could not put at a sentence end (멈춤이 문장 중간) too.
  const gate = draft ? bundle.misses.filter((line) => /못 찾음|빈 화면|그리기 오류|늦게 바뀜|초 미만 장면|문장 중간/.test(line)) : [];
  // 로건 11-13: the same problem sent back again and again stops nothing — past MYIN_GATE_ROUNDS it goes on, marked for a person.
  const rounds = gate.length ? (run.gateRounds ?? 0) + 1 : 0;
  const goOn = gate.length > 0 && rounds > MYIN_GATE_ROUNDS;
  if (goOn) next.prepared!.needsPerson = gate.slice(0, 60);
  if (gate.length && !goOn) {
    const back: MyinRun = { ...next, gateRounds: rounds, review: { decision: "revise", by: record.owner_id ?? run.review?.by ?? record.created_by ?? "", name: MYIN_GATE_NAME,
      note: `렌더 전 관문에서 걸린 곳 ${gate.length}개를 고쳐 주세요: ${gate.slice(0, 12).join(" / ")}`.slice(0, 2000), at: new Date().toISOString() } };
    // The AI fixes a few scenes; the ③ after it draws only those again (바뀐 장면만, 요청 3번).
    const sheetsNow = prepRef(record.id, next);
    if (sheetsNow) back.lastPrep = sheetsNow;
    delete back.prepared; delete back.clips; delete back.stills; delete back.clipsReview; delete back.sound;
    await save(service, record, "backlog", "words_ready", back);
    await resendStoryboard(run.sourceId, record.id, undefined, gptStoryboardFor(run, record));
    return { runId: record.id, stage: "words_ready", misses: bundle.misses.length, returned: true };
  }
  // ③ with nothing missing: the drafts are next, without anyone pressing a button. ④ stops here for the sound and photos check;
  // a 숏폼 has no sound to check (voice only), so its full video starts.
  const rest = goOn ? bundle.misses.filter((line) => !gate.includes(line)) : bundle.misses;
  const stage = rest.length ? "prep_ready" : draft ? "clips_pending" : run.layout || run.resumeFinal ? "final_pending" : "prep_ready";
  delete next.resumeFinal;
  if (stage === "final_pending") retireFinal(next);
  await save(service, record, stage === "prep_ready" ? "done" : "backlog", stage, next);
  // 화면 자동 검사 (2026-10-29): GPT reads the new sheets after this response, while the drafts are being made — unless it was turned off.
  if (bundle.sheets && !run.screenCheckOff) await import("./myin-screen-check").then((module) => module.scheduleScreenCheck(record.id)).catch(() => undefined);
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
  const story = paths.length && run.storyboard ? await sheetsStory(service, run).catch(() => null) : null;
  return { record, run, sheetsAt: run.prepared?.at ?? "", urls: await Promise.all(paths.map((path) => sign(service, SHEET_BUCKET, path))),
    scenes: story?.scenes ?? [], short: run.layout === "short" };
}

/** Logan's preview sheets for the ③ panel (10 minutes). */
export async function myinPreviewSheets(actor: RequestActor, runId: string) {
  const { run } = await visibleRun(actor, runId);
  const service = createServiceSupabase();
  // 점검 시트 장면 의견: each cell's scene (its 시작 문구 and kind) in the storyboard the sheets were drawn from (not the one now, after a 수정안).
  const story = run.prepared?.sheets.length ? await sheetsStory(service, run).catch(() => null) : null;
  const { redraw, drawn, cells } = run.prepared ?? {};
  return { sheets: await Promise.all((run.prepared?.sheets ?? []).map((path) => sign(service, SHEET_BUCKET, path))),
    scenes: (story?.scenes ?? []).map((scene) => ({ type: String(scene.type ?? ""), at: String(scene.at ?? "") })), storyboardAt: story?.at ?? "",
    cells: cells ?? null, redraw: redraw ? { state: redraw.state, code: redraw.code ?? null } : null, drawn: drawn ?? null };
}

// ── 바뀐 장면만 다시 그리기 (직원 요청 2026-11-13): the ③ sheets again for the storyboard now, on the computer with the video's folder ──
const REDRAW_STAGES = ["storyboard_review", "clips_review"];
const REDRAW_LEASE_MS = 10 * 60_000;
const redrawOpen = (record: OsRecord, run: MyinRun) => REDRAW_STAGES.includes(record.stage ?? "") && !run.clipsReview && Boolean(run.storyboard && run.prepared?.sheets.length);

/** 「시트 다시 그리기」: sheets his preview() drew (numbered by his scenes) or a drawing that failed, again. */
export async function requestMyinRedraw(actor: RequestActor, runId: string) {
  const { record, run } = await visibleRun(actor, runId);
  if (!redrawOpen(record, run)) throw new ApiError(409, "MYIN_REDRAW_CLOSED", "③ 미리보기를 확인하는 동안 점검 시트를 다시 그릴 수 있어요.");
  if (run.prepared!.redraw && run.prepared!.redraw.state !== "failed") return presentMyinRun(record);
  const next: MyinRun = { ...run, prepared: { ...run.prepared!, redraw: { state: "pending", at: new Date().toISOString(), attempts: 0 } } };
  return presentMyinRun(await save(createServiceSupabase(), record, record.status, record.stage ?? "", next));
}

/**
 * Render PC (or, with `owner`, that member's own computer — the one that made ③): a video whose sheets wait to be drawn again. Only the
 * scenes resolved differently are drawn when the sheets have their cells (ours); sheets his preview() drew are drawn whole once.
 */
export async function claimMyinRedraw(service: Service = createServiceSupabase(), owner?: string, short = false, pc?: string) {
  const { data } = await service.from("os_records").select("*").eq("record_type", "ai_job").eq("metadata->>kind", MYIN_RUN_KIND).in("stage", REDRAW_STAGES)
    .not("metadata->prepared->redraw", "is", null).is("archived_at", null).order("updated_at").limit(10);
  for (const candidate of (data ?? []) as OsRecord[]) {
    let run: MyinRun; try { run = parse(candidate); } catch { continue; }
    const wait = run.prepared?.redraw;
    if (!wait || wait.state === "failed" || (wait.state === "drawing" && Date.parse(wait.expiresAt ?? "") > Date.now())) continue;
    if (!redrawOpen(candidate, run) || !placeFilter(owner)(run) || !fits(short)(run) || (!owner && pinnedElsewhere(run, pc))) continue;
    if (wait.attempts >= 3) {
      await save(service, candidate, candidate.status, candidate.stage ?? "", { ...run, prepared: { ...run.prepared!, redraw: { ...wait, state: "failed" } } }).catch(() => null);
      continue;
    }
    const token = randomUUID();
    const redraw = { state: "drawing" as const, at: wait.at, attempts: wait.attempts + 1, token, expiresAt: new Date(Date.now() + REDRAW_LEASE_MS).toISOString(),
      storyboardAt: run.storyboard!.at, path: run.storyboard!.path };
    const saved = await save(service, candidate, candidate.status, candidate.stage ?? "", { ...run, prepared: { ...run.prepared!, redraw } }).catch(() => null);
    if (!saved) continue;
    try {
      const story = await storyboardJson(service, run);
      const previous = run.prepared!.cells ? await sheetsStory(service, run) : null;
      // ③ (no drafts confirmed): every photo the storyboard names is fetched, a gray 「사진 자리」 where one cannot be (as the drafts).
      const folders = myinPhotoFolders(story);
      const ours = Object.fromEntries(await Promise.all(Object.entries(run.ours ?? {}).filter(([file]) => folders.has(file))
        .map(async ([file, image]) => [file, await sign(service, OUTPUT_BUCKET, image.path)] as const)));
      const sheetUploadUrls = [];
      for (let n = 1; n <= Math.ceil(story.scenes.length / 12) + 2; n++) {
        const { data: upload } = await service.storage.from(SHEET_BUCKET).createSignedUploadUrl(sheetPath(candidate, run, token, n), { upsert: true });
        if (upload) sheetUploadUrls.push(upload.signedUrl);
      }
      return { runId: candidate.id, lease: token, ...(run.layout ? { layout: run.layout } : {}), ...(run.renderer ? { renderer: run.renderer } : {}), storyboard: await renderStory(story),
        ...(previous ? { previous: await renderStory(previous), sheets: await Promise.all(run.prepared!.sheets.map((path) => sign(service, SHEET_BUCKET, path))) } : {}),
        placeholders: [...folders].flatMap(([file, kinds]) => kinds.map((kind) => ({ kind, file }))), assets: myinPrepPhotos(folders, run.storyboard?.assets ?? [], () => true, ours),
        sheetUploadUrls, ...await subtitlesFor(service, run), ...styleFor(run) };
    } catch (error) {
      await failMyinRedraw({ runId: candidate.id, lease: token, code: error instanceof ApiError ? error.code : "MYIN_REDRAW_CLAIM_FAILED" }, service).catch(() => null);
      throw error;
    }
  }
  return { idle: true as const };
}

const redrawLease = async (service: Service, runId: string, token: string) => {
  const { record, run } = await runRecord(service, runId);
  const redraw = run.prepared?.redraw;
  if (!redraw || redraw.state !== "drawing" || redraw.token !== token || Date.parse(redraw.expiresAt ?? "") < Date.now())
    throw new ApiError(409, "MYIN_LEASE_LOST", "점검 시트를 다시 그리는 권한이 만료됐습니다.");
  return { record, run, prepared: run.prepared!, redraw };
};

export const redrawResultSchema = { sheets: z.number().int().min(1).max(60), cells: z.array(z.number().int().min(1).max(400)).max(600).nullish(),
  drawn: z.array(z.number().int().min(1).max(400)).max(600), lines: z.array(z.string().max(300)).max(60) };

/** The sheets are up: they now show the storyboard the drawing was given (and go again if it changed meanwhile). */
export async function completeMyinRedraw(input: { runId: string; lease: string; sheets: number; cells?: number[] | null; drawn: number[]; lines: string[] }, service: Service = createServiceSupabase()) {
  const { record, run, prepared, redraw } = await redrawLease(service, input.runId, input.lease);
  const at = new Date().toISOString();
  const next: MyinRun["prepared"] = { ...prepared, sheets: Array.from({ length: input.sheets }, (_, i) => sheetPath(record, run, input.lease, i + 1)),
    storyboardPath: redraw.path, storyAt: redraw.storyboardAt, drawn: { at, scenes: input.drawn, lines: input.lines } };
  if (input.cells) next.cells = input.cells; else delete next.cells;
  if (run.storyboard?.at !== redraw.storyboardAt) next.redraw = { state: "pending", at, attempts: 0 }; else delete next.redraw;
  await save(service, record, record.status, record.stage ?? "", { ...run, prepared: next });
  return { runId: record.id, sheets: input.sheets, again: Boolean(next.redraw) };
}

export async function failMyinRedraw(input: { runId: string; lease: string; code: string }, service: Service = createServiceSupabase()) {
  const { record, run, prepared, redraw } = await redrawLease(service, input.runId, input.lease);
  const code = input.code.replace(/[^A-Z0-9_]/g, "").slice(0, 60) || "MYIN_REDRAW_FAILED";
  const next = { state: redraw.attempts >= 3 ? "failed" as const : "pending" as const, at: redraw.at, attempts: redraw.attempts, code };
  await save(service, record, record.status, record.stage ?? "", { ...run, prepared: { ...prepared, redraw: next } });
  return { runId: record.id, retry: next.state === "pending" };
}

// ── 우리 이미지 올리기 (2026-10-28 대표 · 로건): our own photo for a file name the storyboard uses, until the full video starts ──
const OUR_IMAGE_TYPES: Record<string, string> = { "image/jpeg": "jpg", "image/png": "png", "image/webp": "webp" };
/** 사진 칸 영상 클립 (로건 요청 dc9bb251, 2026-11-17): a scene's photo slot also takes a clip; the engine draws its frame at that moment. */
const OUR_PHOTO_TYPES: Record<string, string> = { ...OUR_IMAGE_TYPES, "video/mp4": "mp4", "video/quicktime": "mov" };
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
  const ext = OUR_PHOTO_TYPES[type];
  if (!ext) throw new ApiError(400, "MYIN_OUR_IMAGE_TYPE", "JPG · PNG · WEBP 이미지나 MP4 · MOV 영상만 올릴 수 있어요.");
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
    throw new ApiError(400, "MYIN_OUR_IMAGE_SIZE", "20MB 이하 이미지 · 영상만 올릴 수 있어요.");
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

export async function claimMyinClips(service: Service = createServiceSupabase(), owner?: string, short = false, pc?: string, stills = false) {
  const claimed = await claim(service, "clips_pending", CLIPS_LEASE_MS, (run) => placeFilter(owner)(run) && (!owner || Boolean(run.words?.voice)) && fits(short)(run), materialsKey, drawnWith,
    owner ? undefined : { name: pc });
  if (!claimed) return { idle: true as const };
  const { record, run, lease } = claimed;
  try {
    // 장면 그림 (편집기 3차 요청 11-09): a computer whose engine can draw them makes a longform's scene pictures and timeline (v0) instead
    // of clips; an older one still cuts clips, so the change reaches each computer with its engine. Only before the video's first final:
    // a video that has one goes on through finals and its editing computer, as before.
    if (stills && !run.layout && !run.final && !run.finals?.length) return { runId: record.id, lease: lease.token, stills: true as const, ...(owner ? { seed: await localSeed(service, run) } : {}),
      ...await subtitlesFor(service, run), ...styleFor(run) };
    const items = clipItems(run);
    const uploads = await Promise.all(items.map((item) => uploadUrl(service, ASSET_VIDEO_BUCKET, outPath(record, run, `${item.name}-${tag(lease.token)}.mp4`))));
    return { runId: record.id, lease: lease.token, ...(run.layout ? { layout: run.layout } : {}), ...(run.renderer ? { renderer: run.renderer, storyboard: await renderStory(await storyboardJson(service, run)) } : {}), clips: items.map((item, i) => ({ ...item, uploadUrl: uploads[i] })), ...(owner ? { seed: await localSeed(service, run) } : {}),
      ...await subtitlesFor(service, run), ...styleFor(run) };
  } catch (error) {
    await failed(service, record, run, error instanceof ApiError ? error.code : "MYIN_CLIPS_CLAIM_FAILED");
    throw error;
  }
}
const ASSET_VIDEO_BUCKET = "os-youtube-video";

/** v0's files as the drawing computer lists them (names are checked again with the editor's file rule), and what it says it made. */
export const stillFiles = z.array(z.object({ name: z.string().max(80), bytes: z.number().int().positive().max(300_000_000) }).strict()).min(1).max(600);
export const stills = z.object({ files: z.number().int().min(1).max(600) }).strict().optional();
/** 장면 그림 1/2: where the computer drawing them puts v0's files (the editor screen's folder for this run, 30 minutes). */
export async function myinStillsUpload(input: { runId: string; lease: string; files: { name: string; bytes: number }[] }, service: Service = createServiceSupabase()) {
  const { record, run } = await leased(service, input.runId, input.lease);
  if (record.stage !== "clips_pending" || run.layout) throw new ApiError(409, "MYIN_STILLS_NOT_OPEN", "장면 그림을 만들 차례가 아니에요.");
  return (await import("./myin-edit")).draftMaterialsUpload(service, run.sourceId, record.id, input.files);
}

export async function completeMyinClips(input: { runId: string; lease: string; names?: string[]; stills?: { files: number } }, service: Service = createServiceSupabase()) {
  const { record, run } = await leased(service, input.runId, input.lease);
  // Materials changed while the clips were cut: not taken. A change the preparation used (our images, the storyboard) prepares again first.
  if (staleResult(run)) {
    const again: MyinRun = { ...run, attempts: 0 }; delete again.lease; delete again.lastError;
    const prepAgain = (changedSince(run.prepared?.used, run) ?? ["알 수 없음"]).length > 0;   // unknown (made before 2026-11-03): prepare again
    if (prepAgain) { delete again.prepared; delete again.clips; delete again.stills; }
    await save(service, record, "backlog", prepAgain ? "prep_pending" : "clips_pending", again);
    return { runId: record.id, stage: prepAgain ? "prep_pending" : "clips_pending", again: true };
  }
  const next: MyinRun = { ...run, attempts: 0 };
  if (input.stills && !run.layout && !run.final && !run.finals?.length) {
    // 장면 그림 2/2: the files are up; they become the editor screen's v0 (hand edits waiting on an earlier v0 go away).
    const v0 = await (await import("./myin-edit")).registerDraftVersion(service, run.sourceId, record.id);
    next.stills = { at: new Date().toISOString(), files: v0.files, bytes: v0.bytes, used: materials(run), ...drewWith(run) };
    delete next.clips;
  } else {
    const labels = new Map(clipItems(run).map((item) => [item.name, item.label]));
    const items = (input.names ?? []).filter((name) => labels.has(name)).map((name) => ({ name, label: labels.get(name)!, path: outPath(record, run, `${name}-${tag(input.lease)}.mp4`) }));
    if (!items.length) throw new ApiError(409, "MYIN_CLIPS_MISSING", "미리보기 영상이 올라오지 않았습니다.");
    next.clips = { items, at: new Date().toISOString(), used: materials(run), ...drewWith(run) };
    delete next.stills;
  }
  delete next.lease; delete next.lastError; delete next.clipsReview;
  await save(service, record, "done", "clips_review", next);
  // The drafts wait on a person: whoever confirmed the storyboard and the video's PD hear it (staff test 11-06: nobody knew they were done).
  const { data: project } = await service.from("os_records").select("assignee_id").eq("id", run.sourceId).maybeSingle();
  await notify([run.review?.by, project?.assignee_id].filter((id): id is string => Boolean(id)), "ai_result", run.sourceId, `preview:${record.id}:${(next.stills ?? next.clips)!.at}`);
  return { runId: record.id, stage: "clips_review" };
}

/** Logan's OK on the clips starts the full render; changes go back through 수정 요청 on the storyboard. The same button restarts a stopped full render. */
export async function confirmMyinClips(actor: RequestActor, runId: string, note: string, place?: "pc" | "local") {
  const service = createServiceSupabase();
  const { record, run } = await visibleRun(actor, runId);
  await assertCurrent(service, run);
  if (record.stage !== "clips_review" || !(run.clips || run.stills)) throw new ApiError(409, "MYIN_CLIPS_NOT_IN_REVIEW", "확인을 기다리는 미리보기가 없습니다.");
  // 사진 교체 (2/8 보완): a preview made before a photo (or other material) changed is not the one to confirm.
  const stale = previewStale(run);
  if (stale?.length) throw new ApiError(409, "MYIN_CLIPS_STALE", `미리보기를 만든 뒤 ${stale.join(" · ")}이(가) 바뀌었어요. [미리보기 다시 만들기]로 새로 만든 뒤 확인해 주세요.`);
  const next: MyinRun = { ...run, attempts: 0, clipsReview: { by: actor.id, name: actor.name, note: note.trim().slice(0, 2000), at: new Date().toISOString() } };
  placeStep(next, actor, place);
  retireFinal(next);
  // 장면 그림: 완성 runs ④ and ⑤ in one go (the sound is checked in the editor screen, before), as a 숏폼's ④ does.
  if (run.stills) next.resumeFinal = true;
  // 2026-10-27 대표: 시안 확인이 사진 허락 — ④ 자료 준비(사진 받기 · 구독 대사 음성)를 바로 시작한다.
  const saved = await save(service, record, "done", "clips_review", next);
  return presentMyinRun(await beginPrep(service, saved, parse(saved), actor.id));
}

/**
 * 편집 화면 첫 「완성」 (편집기 3차 요청 11-09): the scene pictures (v0) become the first moving final — ④ and ⑤ in one go, where ③ was made
 * (the pictures, voice and subtitles are already in that computer's folder). An editing computer that applied hand edits first brings
 * the storyboard they made (checked by the caller) and the pictures it put in, which ④ fetches as our images.
 */
export async function finishMyinDraft(actor: RequestActor, sourceId: string, edited?: { storyboard: Record<string, unknown>; images: { file: string; path: string; bytes: number; by: string; name: string; at: string }[] }) {
  const service = createServiceSupabase();
  const latest = await latestRun(service, sourceId);
  if (!latest) throw new ApiError(404, "MYIN_RUN_MISSING", "이 영상은 아직 영상 만들기를 시작하지 않았어요.");
  const { record, run } = latest;
  if (run.clipsReview && !run.final) return { making: true as const, run: presentMyinRun(record) };
  if (record.stage !== "clips_review" || !run.stills) throw new ApiError(409, "EDIT_DRAFT_NOT_READY", "장면 그림이 나온 뒤에 완성할 수 있어요.");
  await assertCurrent(service, run);
  const at = new Date().toISOString();
  const next: MyinRun = { ...run, attempts: 0, resumeFinal: true, clipsReview: { by: actor.id, name: actor.name, note: edited ? "편집 화면에서 고쳐 완성" : "편집 화면에서 완성", at } };
  if (run.local) next.localFinish = { ...run.local, at }; else delete next.localFinish;
  if (edited) {
    const used = myinReferencedFiles(edited.storyboard);
    for (const image of edited.images.filter((i) => used.has(i.file)))
      next.ours = { ...next.ours, [image.file]: { path: image.path, bytes: image.bytes, by: image.by, name: image.name, at: image.at } };
    // A photo the edits newly use that the render PC cannot fetch stops here, before anything is saved.
    photosInUse(next, edited.storyboard as Awaited<ReturnType<typeof storyboardJson>>);
    const kept = await putStoryboard(service, record, run, edited.storyboard);
    next.storyboard = { ...kept, ...storyboardFields(edited.storyboard), model: "편집 화면", at };
  }
  retireFinal(next);
  // One save: the confirmation and ④'s start land together, so a stop in between never leaves 완성 half done.
  return { making: false as const, run: presentMyinRun(await beginPrep(service, record, next, actor.id)) };
}

/**
 * 장면 그림 → 첫 완성본: the scene pictures wait for 완성 (ready), or the first final is being made from them since `making` (the editor
 * screen shows 「v1 완성 중」). Read from four fields of the newest run (the screen asks every few seconds).
 */
export async function myinDraftState(service: Service, sourceId: string) {
  const { data } = await service.from("os_records").select("stage,status,cr:metadata->clipsReview,st:metadata->stills,fin:metadata->final,fins:metadata->finals").eq("parent_id", sourceId)
    .eq("record_type", "ai_job").eq("metadata->>kind", MYIN_RUN_KIND).is("archived_at", null).order("created_at", { ascending: false }).limit(1);
  const row = data?.[0] as { stage?: string; status?: string; cr?: { at?: string } | null; st?: unknown; fin?: unknown; fins?: unknown[] | null } | undefined;
  const first = Boolean(row?.st && !row.fin && !row.fins?.length);
  // ④ · ⑤ at work (or waiting their turn); a stop (a check that found something, a blocked step) waits on a person in the 제작 tab.
  const moving = first && Boolean(row?.cr?.at) && ["cta_pending", "prep_pending", "final_pending"].includes(row?.stage ?? "") && row?.status !== "blocked";
  return { ready: first && row?.stage === "clips_review" && !row?.cr, making: moving ? row!.cr!.at! : null, stopped: first && Boolean(row?.cr) && !moving };
}

/** ④ 끝: after the sound and photos check, the 1080p full video; the same button restarts a stopped one. */
export async function startMyinFinal(actor: RequestActor, runId: string, sizes = false) {
  const service = createServiceSupabase();
  const { record, run } = await visibleRun(actor, runId);
  await assertCurrent(service, run);
  const ready = record.stage === "prep_ready" && Boolean(run.clipsReview) && Boolean(run.prepared) && !run.prepared?.misses.length;
  // 자막 한꺼번에 고치기: a finished video whose subtitles were edited since is made again with them (a new version; the earlier one stays).
  const subtitles = record.stage === "final_ready" && Boolean(run.clipsReview && run.prepared && run.final && run.subtitleEdits)
    && (await subtitleState(service, run)).key !== run.final?.subtitles;
  // 피드용 1:1 · 4:5: a finished web short is made again with its two feed sizes (a new version; the earlier one stays)
  const feed = sizes && run.renderer === "web" && record.stage === "final_ready" && Boolean(run.final && !run.final.sizes);
  if (sizes && run.renderer !== "web") throw new ApiError(409, "MYIN_SIZES_WEB_ONLY", "1:1 · 4:5는 새 편집 스타일 숏폼만 만들 수 있어요.");
  if (!ready && !subtitles && !feed && !(record.stage === "final_pending" && record.status === "blocked"))
    throw new ApiError(409, "MYIN_FINAL_NOT_OPEN", "④ 자료 준비가 끝난 뒤에 전체 영상을 만들 수 있습니다.");
  const next: MyinRun = { ...run, attempts: 0, ...(sizes ? { feedSizes: true as const } : {}) }; delete next.lastError; delete next.lease; retireFinal(next);
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
  ...(run.layout ? {} : { summary: outPath(record, run, `summary-${tag(lease)}.png`), deck: outPath(record, run, `deck-${tag(lease)}.pdf`) }),
  ...(run.renderer === "web" && run.feedSizes ? { sizes: { "1:1": outPath(record, run, `final_1x1-${tag(lease)}.mp4`), "4:5": outPath(record, run, `final_4x5-${tag(lease)}.mp4`) } } : {}) });

/** Render PC: where the finished video, the handouts, the YouTube subtitles and the check report go. */
export async function claimMyinFinal(service: Service = createServiceSupabase(), short = false, owner?: string, pc?: string) {
  const claimed = await claim(service, "final_pending", FINAL_LEASE_MS, (run) => placeFilter(owner)(run) && fits(short)(run), materialsKey, drawnWith, owner ? undefined : { name: pc });
  if (!claimed) return { idle: true as const };
  const { record, run, lease } = claimed;
  try {
    const files = finalFiles(record, run, lease.token);
    // The storyboard as ④ left it (sound edits made after the preparation), written into the render PC's copy before the render.
    return { runId: record.id, lease: lease.token, ...(run.layout ? { layout: run.layout } : {}), ...(run.renderer ? { renderer: run.renderer } : {}), storyboard: await renderStory(await storyboardJson(service, run)),
      videoUploadUrl: await uploadUrl(service, ASSET_VIDEO_BUCKET, files.video), srtUploadUrl: await uploadUrl(service, OUTPUT_BUCKET, files.srt),
      ...(files.summary && files.deck ? { summaryUploadUrl: await uploadUrl(service, OUTPUT_BUCKET, files.summary), deckUploadUrl: await uploadUrl(service, OUTPUT_BUCKET, files.deck) } : {}),
      ...(files.sizes ? { sizeUploadUrls: { "1:1": await uploadUrl(service, ASSET_VIDEO_BUCKET, files.sizes["1:1"]), "4:5": await uploadUrl(service, ASSET_VIDEO_BUCKET, files.sizes["4:5"]) } } : {}),
      ...(owner ? { seed: await localSeed(service, run) } : {}), ...await subtitlesFor(service, run), ...styleFor(run) };
  } catch (error) {
    await failed(service, record, run, error instanceof ApiError ? error.code : "MYIN_FINAL_CLAIM_FAILED");
    throw error;
  }
}

export async function completeMyinFinal(input: { runId: string; lease: string; bytes: number; durationSeconds: number; lufs: number; peak: number; sizes?: boolean }, service: Service = createServiceSupabase()) {
  const { record, run } = await leased(service, input.runId, input.lease);
  if (staleResult(run)) {
    const again: MyinRun = { ...run, attempts: 0 }; delete again.lease; delete again.lastError;
    await save(service, record, "backlog", "final_pending", again);
    return { runId: record.id, stage: "final_pending", again: true };
  }
  const subtitles = run.subtitleEdits ? await subtitleState(service, run).then((state) => state.key, () => undefined) : undefined;
  // the feed sizes count only when the render PC says it made them (an older worker gets the addresses and leaves them empty)
  const { sizes, ...files } = finalFiles(record, run, input.lease);
  const next: MyinRun = { ...run, attempts: 0, final: { ...files, ...(sizes && input.sizes ? { sizes } : {}), bytes: input.bytes, durationSeconds: input.durationSeconds, lufs: input.lufs, peak: input.peak,
    at: new Date().toISOString(), ...(subtitles ? { subtitles } : {}), used: materials(run), ...drewWith(run) } };
  delete next.lease; delete next.lastError; delete next.voiceChanged;
  await save(service, record, "done", "final_ready", next);
  // A final made from the scene pictures as they were keeps them as its own version on the editor screen (로건 11-13: v1 opens there at once);
  // one made after anything changed replaces them, and an editing computer puts that final up as its own version, as before.
  if (!run.layout) await import("./myin-edit").then((edit) => run.stills && (changedSince(run.stills.used, run) ?? ["?"]).length === 0
    ? edit.linkDraftVersion(service, run.sourceId, record.id, next.final!.at) : edit.dropDraftVersion(service, run.sourceId, record.id)).catch(() => undefined);
  return { runId: record.id, stage: "final_ready" };
}

export async function failMyinStage(input: { runId: string; lease: string; code: string }, service: Service = createServiceSupabase()) {
  const { record, run } = await leased(service, input.runId, input.lease);
  // A render PC without this video's folder (one taken before videos stayed with their PC): prepare again where it is rebuilt.
  if (input.code === "MYIN_WORK_MISSING" && !localOwner(run) && run.words?.voice && (record.stage === "clips_pending" || record.stage === "final_pending")) {
    await prepareAgain(service, record, run, record.stage);
    return { runId: record.id, retry: true };
  }
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
    engine: { now: short8(engineNow), prepared: short8(run.prepared?.engine), clips: short8((run.clips ?? run.stills)?.engine), final: short8(run.final?.engine) },
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

/**
 * 진행 소식 (로건 11-13: 「진행 소식은 AI 채팅에도」): where the newest video stands, as lines for the editor's AI chat news — the start,
 * the words, the storyboard and its 확인 or 관문, the scene pictures, the finished video and a stop. Read from the run as it is now.
 */
export async function myinMakingNews(service: Service, projectId: string) {
  const { data } = await service.from("os_records").select("*").eq("parent_id", projectId).eq("record_type", "ai_job").eq("metadata->>kind", MYIN_RUN_KIND)
    .is("archived_at", null).order("created_at", { ascending: false }).limit(1);
  const record = data?.[0] as OsRecord | undefined;
  if (!record) return [];
  const run = parse(record), out: { at: string; kind: string; text: string }[] = [];
  out.push({ at: record.created_at, kind: "making", text: `영상 만들기를 시작했어요: 음성 ${run.paragraphs.length}문단 · 받아쓰기 · 자막.` });
  if (run.words) out.push({ at: run.words.at, kind: "making", text: `음성 · 받아쓰기 · 자막이 끝났어요(낭독 ${Math.round(run.words.durationSeconds / 60)}분).${autoConfirms(run) ? " 내 AI가 장면 기획표를 써요." : ""}` });
  if (run.storyboard) out.push({ at: run.storyboard.at, kind: "making", text: run.storyboard.carried && !run.storyboard.carried.scenes
    ? `원고를 고친 뒤라 전 작업의 장면 기획표를 그대로 썼어요(장면 ${run.storyboard.scenes}개 · 바뀐 문단 ${run.storyboard.carried.changed}개).` : `장면 기획표가 나왔어요(장면 ${run.storyboard.scenes}개).` });
  const review = run.review;
  if (review) out.push({ at: review.at, kind: review.decision === "confirmed" ? "making" : "gate", text: review.decision === "confirmed"
    ? review.name === MYIN_AUTO_CONFIRM_NAME ? "OS 검사를 통과해 기획표를 자동으로 확인했어요. 장면 그림을 만들어요." : `${review.name}님이 기획표를 확인했어요. 장면 그림을 만들어요.`
    : review.name === MYIN_GATE_NAME ? `렌더 전 관문에서 걸린 곳을 내 AI가 고쳐요(${run.gateRounds ?? 1}회차).`
    : review.name === MYIN_CARRY_NAME ? `원고를 고친 곳 ${review.scenes?.length ?? 0}장면만 내 AI가 고쳐요. 나머지 장면은 전 작업의 기획표 그대로예요.` : `${review.name}님이 기획표 수정을 요청했어요: “${review.note.slice(0, 120)}”` });
  if (run.stills) out.push({ at: run.stills.at, kind: "making", text: "장면 그림이 편집 화면 타임라인에 깔렸어요(v0). 보고 고친 뒤 「완성」을 누르면 움직이는 최종본을 만들어요." });
  const prepared = run.prepared;
  if (prepared?.kept?.length) out.push({ at: prepared.at, kind: "making", text: `점검 시트와 렌더 전 검사는 바뀐 장면 ${new Set(prepared.cells ?? []).size - prepared.kept.length}개만 다시 했어요. 나머지 ${prepared.kept.length}장면은 전 결과 그대로예요.` });
  if (prepared?.needsPerson?.length) out.push({ at: prepared.at, kind: "person", text: `관문에서 ${MYIN_GATE_ROUNDS}번 넘게 걸린 곳이 있어 여기서 사람 확인이 필요해요: ${prepared.needsPerson.slice(0, 6).join(" / ")}` });
  const standIns = (prepared?.standIns ?? []).filter((file) => !run.ours?.[file]);
  if (prepared && standIns.length) out.push({ at: prepared.at, kind: "person", text: `우리 이미지 ${standIns.length}장이 없어 회색 사진 자리로 넣었어요: ${standIns.join(" · ")}. 올리면 다시 만들어요.` });
  if (run.final) out.push({ at: run.final.at, kind: "making", text: `완성본이 나왔어요(${Math.floor(run.final.durationSeconds / 60)}분 ${Math.round(run.final.durationSeconds % 60)}초).` });
  if (record.status === "blocked" && run.lastError) out.push({ at: run.lastError.at, kind: "stopped", text: `멈췄어요: ${myinStop(run.lastError.code).why}` });
  return out;
}

/** Short-lived addresses of the clips and the finished files for the ③ panel. */
export async function myinOutputs(actor: RequestActor, runId: string, at?: string) {
  const { record, run } = await visibleRun(actor, runId);
  const service = createServiceSupabase();
  // One file storage no longer holds is null, not the whole answer (로건 11-13: v0's picture video, dropped when v1 landed, failed the
  // call, so the panel never got v1 and showed no player).
  const read = (bucket: string, path?: string) => path ? sign(service, bucket, path).catch(() => null) : Promise.resolve(null);
  // An earlier version of this run's finished video (최종 검토 버전 비교), found by when it was made.
  const final = at ? [...(run.finals ?? []), ...(run.final ? [run.final] : [])].find((item) => item.at === at) : run.final;
  return {
    clips: await Promise.all((run.clips?.items ?? []).map(async (item) => ({ label: item.label, url: await read(ASSET_VIDEO_BUCKET, item.path) }))),
    stills: run.stills && record.parent_id && !run.final ? await import("./myin-edit").then(async ({ draftPreview }) => { const file = await draftPreview(service, record.parent_id!, runId); return read(file.bucket, file.path); }) : null,
    video: await read(ASSET_VIDEO_BUCKET, final?.video), summary: await read(OUTPUT_BUCKET, final?.summary),
    deck: await read(OUTPUT_BUCKET, final?.deck), srt: await read(OUTPUT_BUCKET, final?.srt),
    sizes: final?.sizes ? { "1:1": await read(ASSET_VIDEO_BUCKET, final.sizes["1:1"]), "4:5": await read(ASSET_VIDEO_BUCKET, final.sizes["4:5"]) } : null,
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
/**
 * 롱폼에서 나온 숏폼 (「롱폼 재활용 숏폼 정본」 §1): a longform's newest run whose voice sits on a render PC — its transcript (voice times)
 * and spoken text, the PC that holds the voice file. Null when that voice is not on a render PC or not transcribed yet.
 */
/** 롱폼에서 나온 숏폼: the photos its longform's run used (people and situations), the only ones its storyboard may pick. */
export async function myinRecyclePhotos(run: Pick<MyinRun, "recycle">, service: Service = createServiceSupabase()) {
  if (!run.recycle) return undefined;
  const { data } = await service.from("os_records").select("metadata").eq("id", run.recycle.from).maybeSingle();
  let assets: NonNullable<MyinRun["storyboard"]>["assets"] = [];
  try { assets = data ? parse(data as OsRecord).storyboard?.assets ?? [] : []; } catch { /* an unreadable longform run lends no photos */ }
  return assets.filter((a) => a.kind !== "bgm").map(({ file, url, source, license, use }) => ({ file, url, source, license, use }));
}

export async function myinRecycleSource(service: Service, sourceId: string) {
  const latest = await latestRun(service, sourceId);
  if (!latest?.run.words || !latest.run.pc || latest.run.layout) return null;
  const { data } = await service.storage.from(YOUTUBE_VOICE_TIMING_BUCKET).download(latest.run.words.path);
  if (!data) return null;
  const bundle = JSON.parse(await data.text()) as { words: [number, number, string][]; speech: string };
  return { runId: latest.record.id, pc: latest.run.pc, words: bundle.words, speech: bundle.speech, durationSeconds: latest.run.words.durationSeconds };
}
/** 영상 편집기: when the OS final an edit starts from (the one 최종 검토 shows) was made, or null before the first. */
export async function myinFinalAt(service: Service, sourceId: string) {
  return (await latestRun(service, sourceId))?.run.final?.at ?? null;
}

const editFiles = (record: OsRecord, run: MyinRun, id: string) => ({ video: outPath(record, run, `final_edit-${tag(id)}.mp4`), srt: outPath(record, run, `subs_youtube-edit-${tag(id)}.srt`),
  summary: outPath(record, run, `summary-edit-${tag(id)}.png`), deck: outPath(record, run, `deck-edit-${tag(id)}.pdf`) });
/** 영상 편집기 확정: where the edited final and its YouTube subtitles go, beside the run's own finals. */
export async function myinEditUploads(service: Service, sourceId: string, confirmId: string, handouts = false) {
  const latest = await latestRun(service, sourceId);
  if (!latest?.run.final) throw new ApiError(409, "EDIT_NO_FINAL", "OS에 완성본이 나온 뒤에 확정할 수 있어요.");
  const files = editFiles(latest.record, latest.run, confirmId);
  return { videoUploadUrl: await uploadUrl(service, ASSET_VIDEO_BUCKET, files.video), srtUploadUrl: await uploadUrl(service, OUTPUT_BUCKET, files.srt),
    ...(handouts ? { summaryUploadUrl: await uploadUrl(service, OUTPUT_BUCKET, files.summary), deckUploadUrl: await uploadUrl(service, OUTPUT_BUCKET, files.deck) } : {}) };
}

/**
 * 영상 편집기 확정: the uploaded edit becomes the run's newest final (the one before it stays a version), only while the final it was
 * edited from is still the newest and the OS is not making the video again — two confirms cannot both land (the save checks the version).
 * The handouts (한 장 정리 · 덱) are the edit's own when it brought them (v3 7.2-6), else the ones the OS made stay.
 */
export async function myinAddEditFinal(service: Service, sourceId: string, input: { basedOn: string; bytes: number; lufs: number; peak: number; handouts?: boolean; edit: z.infer<typeof editFinalSchema> }) {
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
  if (input.handouts && (!await size(OUTPUT_BUCKET, files.summary) || !await size(OUTPUT_BUCKET, files.deck))) throw new ApiError(409, "EDIT_UPLOAD_MISSING", "확정본 한 장 정리·덱이 다 올라가지 않았어요. 다시 확정해 주세요.");
  const next: MyinRun = { ...run };
  const handouts = input.handouts ? { summary: files.summary, deck: files.deck }
    : { ...(run.final.summary ? { summary: run.final.summary } : {}), ...(run.final.deck ? { deck: run.final.deck } : {}) };
  retireFinal(next);
  next.final = { video: files.video, srt: files.srt, ...handouts, bytes: input.bytes, durationSeconds: input.edit.check.end, lufs: input.lufs, peak: input.peak, at: new Date().toISOString(), engine: input.edit.engine, edit: input.edit };
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

/** The same list's numbers only, read from the two fields (the editor screen asks every few seconds). */
export async function myinFinalNumbers(service: Service, sourceId: string) {
  const { data } = await service.from("os_records").select("final:metadata->final,finals:metadata->finals").eq("parent_id", sourceId).eq("record_type", "ai_job")
    .eq("metadata->>kind", MYIN_RUN_KIND).is("archived_at", null).order("created_at", { ascending: false }).limit(1);
  type F = { at: string; edit?: { fromVersion: string } };
  const row = data?.[0] as { final?: F | null; finals?: F[] | null } | undefined;
  return [...(row?.finals ?? []), ...(row?.final ? [row.final] : [])].map((final, i) => ({ v: i + 1, at: final.at, edit: final.edit ? { fromVersion: final.edit.fromVersion } : null }));
}

/** 영상 편집기 (v3 7.2-2): the engine that drew the video's newest final (an edited one names its own), if known. */
export async function myinFinalEngine(service: Service, sourceId: string) {
  const final = (await latestRun(service, sourceId))?.run.final;
  return final?.edit?.engine ?? final?.engine ?? null;
}

/** 영상 편집기 사진 (v3 7.2-12): where a picture the editor uses goes — the OS keeps it beside the run, apart from 우리 사진 (which re-prepare ④). */
export async function myinEditorImageUpload(service: Service, sourceId: string, type: string) {
  const latest = await latestRun(service, sourceId);
  if (!latest) throw new ApiError(404, "MYIN_RUN_MISSING", "이 영상은 아직 영상 만들기를 시작하지 않았어요.");
  const ext = OUR_IMAGE_TYPES[type];
  if (!ext) throw new ApiError(400, "MYIN_OUR_IMAGE_TYPE", "JPG · PNG · WEBP 이미지만 올릴 수 있어요.");
  const file = `edit-${randomUUID().slice(0, 12)}.${ext}`;
  const path = outPath(latest.record, latest.run, `editor-images/${file}`);
  return { file, path, uploadUrl: await uploadUrl(service, OUTPUT_BUCKET, path) };
}
/** The picture landed: its size (≤ 20 MB, a larger one is removed), or 0 when it is not there. */
export async function myinEditorImageSize(service: Service, path: string) {
  const slash = path.lastIndexOf("/");
  const { data } = await service.storage.from(OUTPUT_BUCKET).list(path.slice(0, slash), { search: path.slice(slash + 1) });
  const bytes = Number(data?.find((o) => o.name === path.slice(slash + 1))?.metadata?.size ?? 0);
  if (bytes > OUR_IMAGE_MAX_BYTES) { await service.storage.from(OUTPUT_BUCKET).remove([path]); throw new ApiError(400, "MYIN_OUR_IMAGE_SIZE", "20MB 이하 이미지만 올릴 수 있어요."); }
  return bytes;
}
export const myinEditorImageUrl = (service: Service, path: string) => sign(service, OUTPUT_BUCKET, path);

/** 문장 테이크: the video whose voice a sentence take must match — its latest run, voiced on the render PC, a longform. */
export async function myinSayTarget(service: Service, sourceId: string) {
  const latest = await latestRun(service, sourceId);
  if (!latest) throw new ApiError(404, "MYIN_RUN_MISSING", "이 영상은 아직 영상 만들기를 시작하지 않았어요.");
  if (!voiceFixable(latest.record, latest.run)) throw new ApiError(409, "MYIN_SAY_UNAVAILABLE", "이 영상은 문장만 새로 읽을 수 없어요(10/30 16시 전에 시작한 영상 · 숏폼).");
  return { runId: latest.record.id, ownerId: latest.record.owner_id ?? "", voiceReference: latest.run.voiceReference };
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
