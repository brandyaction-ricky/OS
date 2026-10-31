import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest, requireAgentScope } from "@/lib/server/auth";
import { claimStaffJob, completeStaffJob, failStaffJob, listStaffJobs, staffJobWorkerSchema } from "@/lib/server/youtube-ai-jobs";
import { canUseYoutubeStaffScript } from "@/lib/youtube-automation-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
// A saved staff-AI 원고 starts the GPT 두 번째 검수 after the response (next/server after), which can take several minutes.
export const maxDuration = 800;
const headers = { "cache-control": "no-store" };

/**
 * Only a staff member's own agent key (MCP), never a browser session: the AI works the key owner's queue. Opens with ② 원고;
 * ③ 화면 설계 jobs can only be created where the DEV pilot runs, so nothing else reaches this queue in Production.
 */
async function staffAi(request: Request) {
  if (!canUseYoutubeStaffScript(process.env)) throw new ApiError(404, "AUTOMATION_PILOT_DISABLED", "영상 자동화 파일럿이 아직 연결되지 않았습니다.");
  const actor = await authenticateRequest(request, { allowAgent: true, requiredAgentScope: "records.write" });
  if (actor.type !== "agent") throw new ApiError(403, "STAFF_AI_KEY_REQUIRED", "직원 연결 키로 연결해 주세요.");
  requireAgentScope(actor, "knowledge.read");
  return actor;
}

export async function GET(request: Request) {
  try {
    return NextResponse.json(await listStaffJobs(await staffAi(request)), { headers });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await staffAi(request);
    const input = staffJobWorkerSchema.parse(await parseJson(request, 400_000));
    const result = input.action === "claim" ? await claimStaffJob(actor, input.jobId)
      : input.action === "complete" ? await completeStaffJob(actor, input)
      : await failStaffJob(actor, input);
    return NextResponse.json(result, { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "STAFF_AI_JOB_INPUT", "작업 입력을 확인해 주세요. action · job_id · lease · model · result(claim 때 받은 지시의 형식)가 필요합니다. report를 보낼 때는 conclusion(결론 한 줄)이 있어야 하고 did · evidence는 5개까지예요."));
    return apiErrorResponse(error);
  }
}
