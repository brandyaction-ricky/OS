import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { claimMyinClips, claimMyinPrep, completeMyinClips, completeMyinPrep, failMyinPrep, failMyinStage } from "@/lib/server/myin-run";
import { assertLocalEngine, renderPcEngine, renderPcSignalSchema, saveLocalRenderSignal } from "@/lib/server/youtube-render-pc";
import { currentEngineDownload } from "@/lib/server/render-engine";
import { canUseYoutubeAutomationPilot } from "@/lib/youtube-automation-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const lease = { runId: z.string().uuid(), lease: z.string().uuid() };
const engine = z.string().regex(/^[a-f0-9]{16,64}$/);
const inputSchema = z.discriminatedUnion("action", [
  renderPcSignalSchema,
  // The installer asks which engine the render PC runs and where its bundle is.
  z.object({ action: z.literal("engine") }).strict(),
  z.object({ action: z.literal("myin_prep_claim"), engine }).strict(),
  z.object({ action: z.literal("myin_prep_complete"), ...lease }).strict(),
  z.object({ action: z.literal("myin_prep_fail"), ...lease, code: z.string().max(80) }).strict(),
  z.object({ action: z.literal("myin_clips_claim"), engine }).strict(),
  z.object({ action: z.literal("myin_clips_complete"), ...lease, names: z.array(z.string().max(40)).max(201) }).strict(),
  z.object({ action: z.literal("myin_stage_fail"), ...lease, code: z.string().max(80) }).strict(),
]);

/**
 * 내 컴퓨터로 시안 (owner decision 2026-10-27): a member's own Mac runs the render PC's worker with --local and their
 * 「내 컴퓨터 렌더」 key (never the render PC's secret). It only ever gets the ③ drafts that member sent to their own computer,
 * and only while its engine fingerprint equals the render PC's.
 */
export async function POST(request: Request) {
  try {
    if (!canUseYoutubeAutomationPilot(process.env)) throw new ApiError(404, "AUTOMATION_PILOT_DISABLED", "영상 자동화 파일럿이 아직 연결되지 않았습니다.");
    const actor = await authenticateRequest(request, { allowAgent: true, requiredAgentScope: "records.write" });
    if (actor.type !== "agent") throw new ApiError(403, "LOCAL_RENDER_KEY_REQUIRED", "내 컴퓨터 렌더 키로만 쓸 수 있어요.");
    const input = inputSchema.parse(await parseJson(request, 8_000));
    if (input.action === "myin_prep_claim" || input.action === "myin_clips_claim") await assertLocalEngine(input.engine);
    const result = input.action === "heartbeat" ? await saveLocalRenderSignal(actor.ownerId, input)
      : input.action === "engine" ? await currentEngineDownload(await renderPcEngine())
      : input.action === "myin_prep_claim" ? await claimMyinPrep(undefined, actor.ownerId)
      : input.action === "myin_prep_complete" ? await completeMyinPrep(input)
      : input.action === "myin_prep_fail" ? await failMyinPrep(input)
      : input.action === "myin_clips_claim" ? await claimMyinClips(undefined, actor.ownerId)
      : input.action === "myin_clips_complete" ? await completeMyinClips(input)
      : await failMyinStage(input);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_LOCAL_RENDER_REQUEST", "내 컴퓨터 작업 요청을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
