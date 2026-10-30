import { after, NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { shareConfirmedMeeting } from "@/lib/server/meeting-telegram";
import { teamV1Enabled } from "@/lib/team/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const commandSchema = z.object({
  action: z.enum(["meeting.create", "meeting.save", "meeting.start", "meeting.finish", "meeting.review", "meeting.correct", "meeting.import_legacy", "meeting.merge_legacy", "decision.supersede", "decision.drop", "task.merge", "meeting.archive", "meeting.share"]),
  id: z.string().uuid().optional(), expectedVersion: z.number().int().positive().optional(),
}).passthrough();

export async function POST(request: Request) {
  try {
    if (!teamV1Enabled()) throw new ApiError(404, "TEAM_MENU_DISABLED", "팀 화면을 사용할 수 없습니다.");
    const actor = await authenticateRequest(request);
    if (actor.type !== "user") throw new ApiError(403, "USER_REQUIRED", "구성원 계정으로 진행해 주세요.");
    const parsed = commandSchema.safeParse(await parseJson(request, 2_000_000));
    if (!parsed.success) throw new ApiError(400, "INVALID_TEAM_COMMAND", "회의·결정 입력을 확인해 주세요.");
    // 「텔레그램에 올리기」: a confirmed meeting sent again by its owner or an admin (e.g. one confirmed before rooms were set).
    if (parsed.data.action === "meeting.share") {
      const { data: row } = parsed.data.id ? await actor.supabase.from("os_records").select("owner_id,status").eq("id", parsed.data.id).eq("record_type", "meeting").maybeSingle() : { data: null };
      if (!row) throw new ApiError(404, "TEAM_RECORD_NOT_FOUND", "기록을 찾지 못했습니다.");
      if (actor.role !== "admin" && row.owner_id !== actor.id) throw new ApiError(403, "TEAM_FORBIDDEN", "작성자 또는 관리자만 올릴 수 있습니다.");
      if (row.status !== "done") throw new ApiError(409, "MEETING_NOT_CONFIRMED", "확정한 회의만 올릴 수 있어요.");
      const sent = await shareConfirmedMeeting(parsed.data.id!, new URL(request.url).origin);
      if (!sent) throw new ApiError(409, "MEETING_SHARE_NO_ROOM", "올릴 텔레그램 방이 없어요. 회의 사업을 확인하고, 참석자만 보기 회의는 올리지 않아요.");
      return NextResponse.json({ sent }, { headers: { "Cache-Control": "no-store" } });
    }
    const archive = parsed.data.action === "meeting.archive";
    if (archive && (!parsed.data.id || !parsed.data.expectedVersion)) throw new ApiError(400, "INVALID_TEAM_COMMAND", "회의·결정 입력을 확인해 주세요.");
    const { data, error } = archive
      ? await actor.supabase.rpc("os_team_archive_meeting", { p_id: parsed.data.id, p_expected_version: parsed.data.expectedVersion, p_reason: String(parsed.data.reason ?? "회의 삭제") })
      : await actor.supabase.rpc("os_team_command", { p: parsed.data });
    if (error) {
      if (error.message?.includes("OS_MEETING_HAS_LINKED_WORK")) throw new ApiError(409, "MEETING_HAS_LINKED_WORK", "이 회의에서 나온 결정·업무가 남아 있어 지울 수 없습니다. 먼저 정리해 주세요.");
      if (["PGRST202", "42883"].includes(error.code ?? "")) throw new ApiError(503, "TEAM_SCHEMA_REQUIRED", "팀 기능용 DB 변경이 아직 적용되지 않았습니다. 기존 기록은 그대로 보존됩니다.");
      if (["40001", "PT409"].includes(error.code ?? "")) throw new ApiError(409, "VERSION_CONFLICT", "다른 사람이 먼저 수정했습니다. 새로 불러온 뒤 다시 확인해 주세요.");
      if (error.code === "42501") throw new ApiError(403, "TEAM_FORBIDDEN", "이 작업을 수행할 권한이 없습니다.");
      if (error.code === "P0002") throw new ApiError(404, "TEAM_RECORD_NOT_FOUND", "기록을 찾지 못했습니다.");
      throw new ApiError(400, "TEAM_COMMAND_FAILED", "저장하지 못했습니다. 상태와 입력 내용을 확인해 주세요.");
    }
    // A confirmed meeting's summary goes to the Telegram chats that asked for it; a failed send never undoes the confirm.
    if (parsed.data.action === "meeting.review" && parsed.data.id) { const id = parsed.data.id, origin = new URL(request.url).origin; after(() => shareConfirmedMeeting(id, origin).catch(cause => console.warn("[telegram] meeting summary", cause))); }
    return NextResponse.json(data, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
