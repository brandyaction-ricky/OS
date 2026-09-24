import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { safeSecretMatch } from "@/lib/server/auth";
import { buildYoutubeRenderBrief, claimYoutubeRender, completeYoutubeRender, failYoutubeRender } from "@/lib/server/youtube-render-run";
import { canUseYoutubeAutomationPilot } from "@/lib/youtube-automation-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const lease = { renderId: z.string().uuid(), lease: z.string().uuid() };
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("claim") }).strict(),
  z.object({ action: z.literal("brief"), ...lease, segmentDurations: z.array(z.number().positive().max(3_600)).min(1).max(80), durationSeconds: z.number().positive().max(14_400) }).strict(),
  z.object({ action: z.literal("complete"), ...lease, videoBytes: z.number().int().positive(), videoSha256: z.string().regex(/^[a-f0-9]{64}$/) }).strict(),
  z.object({ action: z.literal("fail"), ...lease, code: z.string().max(80) }).strict(),
]);

/** The media worker (Mac during development, Vercel Sandbox later) holds only this dedicated secret. */
export async function POST(request: Request) {
  try {
    if (!canUseYoutubeAutomationPilot(process.env)) throw new ApiError(404, "AUTOMATION_PILOT_DISABLED", "영상 자동화 파일럿이 아직 연결되지 않았습니다.");
    const expected = process.env.YOUTUBE_MEDIA_WORKER_SECRET ?? "";
    const received = request.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "";
    if (expected.length < 32 || !safeSecretMatch(received, expected)) throw new ApiError(401, "INVALID_WORKER_SECRET", "미디어 워커 인증에 실패했습니다.");
    const input = inputSchema.parse(await parseJson(request, 20_000));
    const result = input.action === "claim" ? await claimYoutubeRender()
      : input.action === "brief" ? await buildYoutubeRenderBrief(input)
      : input.action === "complete" ? await completeYoutubeRender(input)
      : await failYoutubeRender(input);
    return NextResponse.json(result, { headers: { "cache-control": "no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_WORKER_INPUT", "미디어 워커 요청을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
