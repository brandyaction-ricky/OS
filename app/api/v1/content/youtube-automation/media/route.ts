import { DIAGRAM_TYPES } from "@/lib/shortform-diagram-catalog";
import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { safeSecretMatch } from "@/lib/server/auth";
import { buildYoutubeRenderBrief, claimYoutubeRender, completeYoutubeRender, failYoutubeRender } from "@/lib/server/youtube-render-run";
import { MYIN_VOICE_PARTS, claimMyinBreath, claimMyinClips, claimMyinFinal, claimMyinPrep, claimMyinWords, completeMyinBreath, completeMyinClips, completeMyinFinal, completeMyinPrep, completeMyinWords, failMyinPrep, failMyinStage, failMyinWords } from "@/lib/server/myin-run";
import { renderPcSignalSchema, saveRenderPcSignal } from "@/lib/server/youtube-render-pc";
import { engineReadySchema, engineUploadSchema, engineUploadUrls, saveEngineManifest } from "@/lib/server/render-engine";
import { canUseYoutubeAutomationPilot } from "@/lib/youtube-automation-gate";
import { claimShortformRender,shortformVoice,completeShortformRender,failShortformRender } from "@/lib/server/shortform-render";
import { claimShortRefs, completeShortRefs, failShortRefs, shortRefsCompleteSchema, shortRefsFailSchema } from "@/lib/server/youtube-process-short-refs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const lease = { renderId: z.string().uuid(), lease: z.string().uuid() };
const inputSchema = z.discriminatedUnion("action", [
  z.object({action:z.literal("shorts_claim"),layoutVersion:z.union([z.literal(2),z.literal(3),z.literal(4)]),renderId:z.string().uuid().optional(),diagramTypes:z.array(z.enum(DIAGRAM_TYPES)).max(70).optional()}).strict(),
  z.object({action:z.literal("shorts_voice"),...lease,index:z.number().int().min(0).max(19)}).strict(),
  z.object({action:z.literal("shorts_complete"),...lease,bytes:z.number().int().positive().max(50_000_000),
    sha256:z.string().regex(/^[a-f0-9]{64}$/),duration:z.number().positive().max(61)}).strict(),
  z.object({action:z.literal("shorts_fail"),...lease,code:z.string().max(80)}).strict(),
  z.object({ action: z.literal("claim"), voiceRunId: z.string().uuid().optional() }).strict(),
  z.object({ action: z.literal("brief"), ...lease, segmentDurations: z.array(z.number().positive().max(3_600)).min(1).max(80), durationSeconds: z.number().positive().max(14_400) }).strict(),
  z.object({ action: z.literal("complete"), ...lease, videoBytes: z.number().int().positive(), videoSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal("fail"), ...lease, code: z.string().max(80) }).strict(),
  // 마이인 v13 stage 1: breath commas for Fish (로건 호흡·타이밍), then voice post-processing, words.json and subtitles on the render PC.
  engineUploadSchema, engineReadySchema,
  z.object({ action: z.literal("myin_breath_claim") }).strict(),
  z.object({ action: z.literal("myin_breath_complete"), runId: z.string().uuid(), lease: z.string().uuid(),
    breaths: z.array(z.object({ index: z.number().int().min(0).max(149), after: z.array(z.number().int().min(0).max(400)).max(80) }).strict()).max(150) }).strict(),
  z.object({ action: z.literal("myin_claim"), short: z.literal(true).optional() }).strict(),
  z.object({ action: z.literal("myin_complete"), runId: z.string().uuid(), lease: z.string().uuid(),
    voice: z.object({ parts: z.number().int().min(1).max(MYIN_VOICE_PARTS), bytes: z.number().int().positive(), sha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict().optional() }).strict(),
  z.object({ action: z.literal("myin_fail"), runId: z.string().uuid(), lease: z.string().uuid(), code: z.string().max(80) }).strict(),
  // Stage 3: approved photos and music, CTA voice, Logan's preview check.
  z.object({ action: z.literal("myin_prep_claim"), short: z.literal(true).optional() }).strict(),
  z.object({ action: z.literal("myin_prep_complete"), runId: z.string().uuid(), lease: z.string().uuid() }).strict(),
  z.object({ action: z.literal("myin_prep_fail"), runId: z.string().uuid(), lease: z.string().uuid(), code: z.string().max(80) }).strict(),
  // Stage 4: Logan's clips, then the full render, mix and handouts.
  z.object({ action: z.literal("myin_clips_claim"), short: z.literal(true).optional() }).strict(),
  // One clip per metaphor scene plus the opening; a storyboard has at most 200 scenes, and stage diagrams make most of them metaphors.
  z.object({ action: z.literal("myin_clips_complete"), runId: z.string().uuid(), lease: z.string().uuid(), names: z.array(z.string().max(40)).max(201) }).strict(),
  z.object({ action: z.literal("myin_final_claim"), short: z.literal(true).optional() }).strict(),
  z.object({ action: z.literal("myin_final_complete"), runId: z.string().uuid(), lease: z.string().uuid(), bytes: z.number().int().positive(),
    durationSeconds: z.number().positive().max(14_400), lufs: z.number().min(-70).max(0), peak: z.number().min(-70).max(6) }).strict(),
  z.object({ action: z.literal("myin_stage_fail"), runId: z.string().uuid(), lease: z.string().uuid(), code: z.string().max(80) }).strict(),
  // 숏폼 레퍼런스 받기 (2026-10-28): thumbnails, the first three seconds and the words of the 대본 step's references.
  z.object({ action: z.literal("short_refs_claim") }).strict(), shortRefsCompleteSchema, shortRefsFailSchema,
  renderPcSignalSchema,
]);

/** The media worker (Mac during development, Vercel Sandbox later) holds only this dedicated secret. */
export async function POST(request: Request) {
  try {
    if (!canUseYoutubeAutomationPilot(process.env)) throw new ApiError(404, "AUTOMATION_PILOT_DISABLED", "영상 자동화 파일럿이 아직 연결되지 않았습니다.");
    const expected = process.env.YOUTUBE_MEDIA_WORKER_SECRET ?? "";
    const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (expected.length < 32 || !safeSecretMatch(received, expected)) throw new ApiError(401, "INVALID_WORKER_SECRET", "미디어 워커 인증에 실패했습니다.");
    // A 레퍼런스 받기 result carries up to ten transcripts.
    const input = inputSchema.parse(await parseJson(request, 120_000));
    const result = input.action === "heartbeat" ? await saveRenderPcSignal(input)
      : input.action === "engine_upload" ? await engineUploadUrls(input)
      : input.action === "engine_ready" ? await saveEngineManifest(input)
      : input.action === "shorts_claim" ? await claimShortformRender(undefined, input.layoutVersion,input.diagramTypes,input.renderId)
      : input.action === "shorts_voice" ? await shortformVoice(input)
      : input.action === "shorts_complete" ? await completeShortformRender(input)
      : input.action === "shorts_fail" ? await failShortformRender(input)
      : input.action === "claim" ? await claimYoutubeRender(undefined, input.voiceRunId)
      : input.action === "brief" ? await buildYoutubeRenderBrief(input)
      : input.action === "complete" ? await completeYoutubeRender(input)
      : input.action === "myin_breath_claim" ? await claimMyinBreath()
      : input.action === "myin_breath_complete" ? await completeMyinBreath(input)
      : input.action === "myin_claim" ? await claimMyinWords(undefined, Boolean(input.short))
      : input.action === "myin_complete" ? await completeMyinWords(input)
      : input.action === "myin_fail" ? await failMyinWords(input)
      : input.action === "myin_prep_claim" ? await claimMyinPrep(undefined, undefined, Boolean(input.short))
      : input.action === "myin_prep_complete" ? await completeMyinPrep(input)
      : input.action === "myin_prep_fail" ? await failMyinPrep(input)
      : input.action === "myin_clips_claim" ? await claimMyinClips(undefined, undefined, Boolean(input.short))
      : input.action === "myin_clips_complete" ? await completeMyinClips(input)
      : input.action === "myin_final_claim" ? await claimMyinFinal(undefined, Boolean(input.short))
      : input.action === "myin_final_complete" ? await completeMyinFinal(input)
      : input.action === "myin_stage_fail" ? await failMyinStage(input)
      : input.action === "short_refs_claim" ? await claimShortRefs()
      : input.action === "short_refs_complete" ? await completeShortRefs(input)
      : input.action === "short_refs_fail" ? await failShortRefs(input)
      : await failYoutubeRender(input);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_WORKER_INPUT", "미디어 워커 요청을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
