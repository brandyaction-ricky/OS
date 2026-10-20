import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { confirmScriptPreparation, saveScriptBundle, scriptBundleSchema } from "@/lib/server/youtube-script-job";
import { canUseYoutubeStaffScript } from "@/lib/youtube-automation-gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };

// ② 원고: a script the staff member wrote with their own AI by hand (원고 공정 정본 §12-4) goes through the same save as a
// staff AI job; "confirm" is the one staff check that replaces the eight per-step approvals.
const inputSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("submit"), sourceId: z.string().uuid(), expectedVersion: z.number().int().positive(),
    targetMinutes: z.number().int().min(1).max(60).default(10), bundle: scriptBundleSchema }).strict(),
  z.object({ action: z.literal("confirm"), sourceId: z.string().uuid(), expectedVersion: z.number().int().positive() }).strict(),
]);

export async function POST(request: Request) {
  try {
    if (!canUseYoutubeStaffScript(process.env)) throw new ApiError(404, "AUTOMATION_PILOT_DISABLED", "영상 자동화 파일럿이 아직 연결되지 않았습니다.");
    const actor = await authenticateRequest(request, { allowAgent: false });
    const input = inputSchema.parse(await parseJson(request, 200_000));
    if (input.action === "confirm") return NextResponse.json({ source: await confirmScriptPreparation(actor, input.sourceId, input.expectedVersion) }, { headers });
    const { data: source } = await actor.supabase.from("os_records").select("owner_id").eq("id", input.sourceId).maybeSingle();
    if (source?.owner_id !== actor.id) throw new ApiError(403, "CONTENT_OWNER_REQUIRED", "이 콘텐츠의 담당 직원만 원고를 넣을 수 있습니다.");
    return NextResponse.json(await saveScriptBundle(actor, input.sourceId, input.bundle, { type: "staff", model: "직원 직접 입력", targetMinutes: input.targetMinutes }, input.expectedVersion), { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "SCRIPT_INPUT_INVALID", `입력을 확인해 주세요: ${error.issues.slice(0, 5).map((issue) => `${issue.path.join(".")} ${issue.message}`).join(" / ")}`));
    return apiErrorResponse(error);
  }
}
