import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { teamV1Enabled } from "@/lib/team/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const idSchema = z.string().uuid();
const commentSchema = z.object({ id: idSchema, text: z.string().trim().min(1).max(2000) });

async function taskForUser(request: Request, id: string) {
  if (!teamV1Enabled()) throw new ApiError(404, "TEAM_MENU_DISABLED", "팀 화면을 사용할 수 없습니다.");
  const actor = await authenticateRequest(request);
  if (actor.type !== "user") throw new ApiError(403, "USER_REQUIRED", "구성원 계정으로 진행해 주세요.");
  const { data, error } = await actor.supabase.from("os_records")
    // Meetings too: attendees' one-line notes during a meeting are comments on the meeting record.
    .select("id,record_type").eq("id", id).in("record_type", ["task", "meeting"]).is("archived_at", null).maybeSingle();
  if (error || !data) throw new ApiError(404, "TEAM_TASK_NOT_FOUND", "업무를 찾지 못했습니다.");
  return { actor, task: data };
}

export async function GET(request: Request) {
  try {
    const id = idSchema.safeParse(new URL(request.url).searchParams.get("id"));
    if (!id.success) throw new ApiError(400, "INVALID_TASK_ID", "업무 주소를 확인해 주세요.");
    const { actor } = await taskForUser(request, id.data);
    const { data, error } = await actor.supabase.from("os_record_events")
      .select("id,actor_id,event_type,note,created_at").eq("record_id", id.data)
      .order("created_at", { ascending: false }).limit(100);
    if (error) throw new ApiError(503, "TASK_ACTIVITY_FAILED", "업무 활동을 불러오지 못했습니다.");
    return NextResponse.json({ activity: data ?? [] }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const parsed = commentSchema.safeParse(await parseJson(request, 4000));
    if (!parsed.success) throw new ApiError(400, "INVALID_TASK_COMMENT", "댓글 내용을 확인해 주세요.");
    const { actor, task } = await taskForUser(request, parsed.data.id);
    const { error } = await createServiceSupabase().from("os_record_events").insert({
      record_id: task.id, actor_id: actor.id, event_type: "comment", note: parsed.data.text,
      // Keep comments out of the version-restore snapshots. A partial snapshot
      // with a version could otherwise be mistaken for a restorable record.
      snapshot: {},
    });
    if (error) throw new ApiError(503, "TASK_COMMENT_FAILED", "댓글을 저장하지 못했습니다.");
    return NextResponse.json({ saved: true }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}
