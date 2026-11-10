import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest, requireAgentScope } from "@/lib/server/auth";
import { canUseYoutubeStaffScript } from "@/lib/youtube-automation-gate";
import { imageAssetForJob, imageAssetWorkerSchema } from "@/lib/server/youtube-ai-jobs";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request) {
  try {
    if (!canUseYoutubeStaffScript(process.env)) throw new ApiError(404, "IMAGE_WORKER_UNAVAILABLE", "내 AI 작업 연결이 아직 꺼져 있어요.");
    const actor = await authenticateRequest(request, { allowAgent: true, requiredAgentScope: "records.write" });
    if (actor.type !== "agent") throw new ApiError(403, "STAFF_AI_KEY_REQUIRED", "연결된 내 AI 작업에서만 사용해요.");
    requireAgentScope(actor, "knowledge.read");
    const input = imageAssetWorkerSchema.parse(await parseJson(request, 10_000));
    return Response.json(await imageAssetForJob(actor, input), { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error instanceof ZodError ? new ApiError(422, "IMAGE_ASSET_REQUEST_INVALID", "작업·업로드 정보를 확인해 주세요.") : error); }
}
