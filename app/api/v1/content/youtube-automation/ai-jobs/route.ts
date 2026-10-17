import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { requestScenePlanJob, staffJobRequestSchema, staffJobStatus } from "@/lib/server/youtube-ai-jobs";
import { canUseYoutubeAutomationPilot } from "@/lib/youtube-automation-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
const disabled = () => new ApiError(404, "AUTOMATION_PILOT_DISABLED", "영상 자동화 파일럿이 아직 연결되지 않았습니다.");

/** The latest staff AI job for one video and when the requester's AI last used its key. */
export async function GET(request: Request) {
  try {
    if (!canUseYoutubeAutomationPilot(process.env)) throw disabled();
    const actor = await authenticateRequest(request, { allowAgent: false });
    const sourceId = z.string().uuid().parse(new URL(request.url).searchParams.get("sourceId"));
    return NextResponse.json(await staffJobStatus(actor, sourceId), { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_AUTOMATION_INPUT", "콘텐츠를 확인해 주세요."));
    return apiErrorResponse(error);
  }
}

/** 영상 제작 › 화면 설계 › [내 AI에 보내기]. */
export async function POST(request: Request) {
  try {
    if (!canUseYoutubeAutomationPilot(process.env)) throw disabled();
    const actor = await authenticateRequest(request, { allowAgent: false });
    const input = staffJobRequestSchema.parse(await parseJson(request, 1_000));
    return NextResponse.json({ job: await requestScenePlanJob(actor, input) }, { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_AUTOMATION_INPUT", "콘텐츠와 원고 버전을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
