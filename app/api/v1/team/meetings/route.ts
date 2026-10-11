import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest, type RequestActor } from "@/lib/server/auth";
import { knowledgeAccessContext } from "@/lib/server/knowledge-access";
import { projectMeetings } from "@/lib/knowledge/meetings";
import { teamV1Enabled } from "@/lib/team/gate";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function readError() {
  return new ApiError(503, "TEAM_MEETINGS_READ_FAILED", "회의 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.");
}

async function readMeetings(actor: RequestActor) {
  const rows: Parameters<typeof projectMeetings>[0] = [];
  for (let offset = 0; ; offset += 500) {
    const result = await actor.supabase.from("os_records")
      .select("id,title,description,status,version,owner_id,created_by,updated_at,starts_at,brand,metadata")
      .eq("record_type", "meeting").is("archived_at", null).order("id").range(offset, offset + 499);
    if (result.error) throw readError();
    rows.push(...(result.data ?? []));
    if (!result.data || result.data.length < 500) return rows;
  }
}

async function readDecisions(actor: RequestActor) {
  const rows: Parameters<typeof projectMeetings>[1] = [];
  for (let offset = 0; ; offset += 500) {
    const result = await actor.supabase.from("os_records")
      .select("id,title,status,version,owner_id,created_by,created_at,updated_at,parent_id,metadata")
      .eq("record_type", "decision").eq("status", "decided").is("archived_at", null).order("id").range(offset, offset + 499);
    if (result.error) throw readError();
    rows.push(...(result.data ?? []));
    if (!result.data || result.data.length < 500) return rows;
  }
}

async function readAttendees(actor: RequestActor, meetingIds: string[]) {
  const rows: Parameters<typeof projectMeetings>[2] = [];
  for (let chunk = 0; chunk < meetingIds.length; chunk += 100) {
    const ids = meetingIds.slice(chunk, chunk + 100);
    for (let offset = 0; ; offset += 500) {
      const result = await actor.supabase.from("os_meeting_attendees")
        .select("meeting_id,user_id").in("meeting_id", ids).order("meeting_id").order("user_id").range(offset, offset + 499);
      if (result.error) throw readError();
      rows.push(...(result.data ?? []));
      if (!result.data || result.data.length < 500) break;
    }
  }
  return rows;
}

export async function GET(request: Request) {
  try {
    const user = await authenticateRequest(request);
    if (!teamV1Enabled()) throw new ApiError(404, "TEAM_MENU_DISABLED", "팀 화면을 사용할 수 없습니다.");
    const { actor } = await knowledgeAccessContext(user, []);
    const meetings = await readMeetings(user);
    const [decisions, attendees] = await Promise.all([
      meetings.some(meeting => meeting.metadata?.workspace !== "knowledge") ? readDecisions(user) : Promise.resolve([]),
      readAttendees(user, meetings.map(meeting => meeting.id)),
    ]);
    const visible = projectMeetings(meetings, decisions, attendees, actor).map(meeting => ({
      ...meeting,
      metadata: { ...meeting.metadata, items: Array.isArray(meeting.metadata.items) ? meeting.metadata.items : [] },
    }));
    return NextResponse.json({ meetings: visible }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiErrorResponse(error instanceof ApiError ? error : readError());
  }
}
