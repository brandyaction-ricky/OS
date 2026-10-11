import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { teamV1Enabled } from "@/lib/team/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const commandSchema = z.object({
  action: z.enum(["meeting.create", "meeting.save", "meeting.start", "meeting.finish", "meeting.review", "meeting.correct", "meeting.import_legacy", "meeting.merge_legacy", "decision.supersede", "decision.drop", "task.merge"]),
  id: z.string().uuid().optional(), expectedVersion: z.number().int().positive().optional(),
}).passthrough();

export async function POST(request: Request) {
  try {
    if (!teamV1Enabled()) throw new ApiError(404, "TEAM_MENU_DISABLED", "팀 화면을 사용할 수 없습니다.");
    const actor = await authenticateRequest(request);
    if (actor.type !== "user") throw new ApiError(403, "USER_REQUIRED", "구성원 계정으로 진행해 주세요.");
    const parsed = commandSchema.safeParse(await parseJson(request, 2_000_000));
    if (!parsed.success) throw new ApiError(400, "INVALID_TEAM_COMMAND", "회의·결정 입력을 확인해 주세요.");
    const { data, error } = await actor.supabase.rpc("os_team_command", { p: parsed.data });
    if (error) {
      if (["PGRST202", "42883"].includes(error.code ?? "")) throw new ApiError(503, "TEAM_SCHEMA_REQUIRED", "팀 기능용 DB 변경이 아직 적용되지 않았습니다. 기존 기록은 그대로 보존됩니다.");
      if (["40001", "PT409"].includes(error.code ?? "")) throw new ApiError(409, "VERSION_CONFLICT", "다른 사람이 먼저 수정했습니다. 새로 불러온 뒤 다시 확인해 주세요.");
      if (error.code === "42501") throw new ApiError(403, "TEAM_FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
      if (error.code === "P0002") throw new ApiError(404, "TEAM_RECORD_NOT_FOUND", "기록을 찾지 못했습니다.");
      throw new ApiError(400, "TEAM_COMMAND_FAILED", "저장하지 못했습니다. 상태와 입력 내용을 확인해 주세요.");
    }
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
