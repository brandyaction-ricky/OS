import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { knowledgeAccessContext } from "@/lib/server/knowledge-access";
import { projectMeetings } from "@/lib/knowledge/meetings";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const readError = () => new ApiError(503, "MEETINGS_READ_FAILED", "회의록 목록을 불러오지 못했습니다. 다시 시도해 주세요.");

async function readMeetings(db: Awaited<ReturnType<typeof authenticateRequest>>["supabase"]) {
  const records: Parameters<typeof projectMeetings>[0] = [];
  for (let offset = 0;; offset += 500) {
    const result = await db.from("os_records")
      .select("id,title,status,version,owner_id,created_by,created_at,updated_at,starts_at,workspace:metadata->>workspace,visibility:metadata->>visibility")
      .eq("record_type", "meeting").is("archived_at", null).order("id").range(offset, offset + 499);
    if (result.error) throw readError();
    // Visibility projection needs only these two metadata keys, never meeting notes.
    records.push(...(result.data ?? []).map(({ workspace, visibility, ...record }) => ({
      ...record, metadata: { workspace, visibility },
    })));
    if (!result.data || result.data.length < 500) return records;
  }
}

export async function GET(request: Request) {
  try {
    const user = await authenticateRequest(request);
    const db = user.supabase;
    const [access, records] = await Promise.all([
      knowledgeAccessContext(user, []),
      readMeetings(db),
    ]);
    const attendance: Array<{ meeting_id: string; user_id: string }> = [];
    for (let offset = 0; offset < records.length; offset += 100) {
      const ids = records.slice(offset, offset + 100).map(row => row.id);
      for (let page = 0;; page += 500) {
        const result = await db.from("os_meeting_attendees")
          .select("meeting_id,user_id").in("meeting_id", ids)
          .order("meeting_id").order("user_id").range(page, page + 499);
        if (result.error) throw readError();
        attendance.push(...(result.data ?? []));
        if (!result.data || result.data.length < 500) break;
      }
    }
    const visible = projectMeetings(records, [], attendance, access.actor);
    const ids = [...new Set(visible.flatMap(meeting => meeting.attendees))];
    const people: Array<{ id: string; display_name: string }> = [];
    if (ids.length) {
      const service = createServiceSupabase();
      for (let offset = 0; offset < ids.length; offset += 200) {
        const profiles = await service.from("os_profiles")
          .select("id,display_name").eq("is_active", true).in("id", ids.slice(offset, offset + 200));
        if (profiles.error) throw readError();
        people.push(...(profiles.data ?? []));
      }
    }
    return NextResponse.json({
      meetings: visible.map(meeting => ({
        id: meeting.id, title: meeting.title, status: meeting.status,
        starts_at: meeting.starts_at, updated_at: meeting.updated_at,
        attendees: meeting.attendees, visibility: meeting.metadata.visibility,
      })),
      people,
    }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiErrorResponse(error instanceof ApiError ? error : readError());
  }
}
