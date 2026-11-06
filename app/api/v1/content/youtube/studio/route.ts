import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { listStudioTasks, queueStudioAgain, reportStudio, studioQueueSchema, studioReportSchema, studioStatus, studioTaskView } from "@/lib/server/youtube-studio";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
const querySchema = z.object({ projectId: z.string().uuid().optional(), view: z.enum(["status", "task"]).default("status"), start: z.enum(["1"]).optional() }).strict();

/**
 * 스튜디오 작업 (MCP get_upload_studio_task): no projectId = this person's videos with Studio work now or later; view=status = the upload
 * tab's line per item; view=task = every value for Studio with files signed for six hours, start=1 also takes the task (one at a time).
 */
export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request, { allowAgent: true, requiredAgentScope: "knowledge.read" });
    const input = querySchema.parse(Object.fromEntries(new URL(request.url).searchParams));
    if (!input.projectId) return NextResponse.json(await listStudioTasks(actor), { headers });
    if (input.view === "task") return NextResponse.json(await studioTaskView(actor, input.projectId, input.start === "1"), { headers });
    return NextResponse.json(await studioStatus(actor, input.projectId), { headers });
  } catch (error) {
    return apiErrorResponse(error instanceof ZodError ? new ApiError(400, "STUDIO_QUERY_INVALID", "영상을 확인해 주세요.") : error);
  }
}

/** action=report (MCP report_studio_done): one item 등록됨 or 못 함; action=queue (업로드 탭): make the task, or hand one item over again. */
export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request, { allowAgent: true, requiredAgentScope: "records.write" });
    const { action, ...body } = await parseJson(request, 20_000) as { action?: string };
    if (action === "report") return NextResponse.json(await reportStudio(actor, studioReportSchema.parse(body)), { headers });
    if (action === "queue") return NextResponse.json(await queueStudioAgain(actor, studioQueueSchema.parse(body)), { headers });
    throw new ApiError(400, "STUDIO_ACTION_INVALID", "할 일을 확인해 주세요.");
  } catch (error) {
    return apiErrorResponse(error instanceof ZodError ? new ApiError(400, "STUDIO_INPUT_INVALID", error.issues[0]?.message ?? "입력을 확인해 주세요.") : error);
  }
}
