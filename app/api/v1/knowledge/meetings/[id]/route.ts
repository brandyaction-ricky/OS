import { NextResponse } from "next/server";
import { z } from "zod";
import { apiErrorResponse, ApiError } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";
import { knowledgeAccessContext } from "@/lib/server/knowledge-access";
import { projectMeetings } from "@/lib/knowledge/meetings";
import type { Person } from "@/lib/knowledge/model";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const parsed = z.string().uuid().safeParse((await params).id);
    if (!parsed.success) throw new ApiError(400, "INVALID_MEETING_ID", "회의 주소를 확인해 주세요.");
    const user = await authenticateRequest(request);
    const db = user.supabase;
    const [{ actor }, meetingResult, attendeeResult] = await Promise.all([
      knowledgeAccessContext(user, []),
      db.from("os_records").select("id,title,description,status,version,owner_id,created_by,created_at,updated_at,starts_at,parent_id,metadata").eq("id", parsed.data).eq("record_type", "meeting").is("archived_at", null).maybeSingle(),
      db.from("os_meeting_attendees").select("meeting_id,user_id").eq("meeting_id", parsed.data),
    ]);
    if (meetingResult.error || attendeeResult.error) throw new ApiError(503, "MEETING_READ_FAILED", "회의록을 불러오지 못했습니다.");
    if (!meetingResult.data) throw new ApiError(404, "MEETING_NOT_FOUND", "이 회의를 볼 권한이 없습니다.");
    let decisions: Parameters<typeof projectMeetings>[1] = [];
    if (meetingResult.data.metadata?.workspace !== "knowledge") {
      const [children, linked] = await Promise.all([
        db.from("os_records").select("id,title,status,version,owner_id,created_by,created_at,updated_at,parent_id,metadata").eq("record_type", "decision").eq("status", "decided").is("archived_at", null).eq("parent_id", parsed.data),
        db.from("os_records").select("id,title,status,version,owner_id,created_by,created_at,updated_at,parent_id,metadata").eq("record_type", "decision").eq("status", "decided").is("archived_at", null).contains("metadata", { meetingId: parsed.data }),
      ]);
      if (children.error || linked.error) throw new ApiError(503, "MEETING_READ_FAILED", "회의 결정을 불러오지 못했습니다.");
      decisions = [...new Map([...(children.data ?? []), ...(linked.data ?? [])].map(row => [row.id, row])).values()];
    }
    const meeting = projectMeetings([meetingResult.data], decisions, attendeeResult.data ?? [], actor)[0];
    if (!meeting) throw new ApiError(404, "MEETING_NOT_FOUND", "이 회의를 볼 권한이 없습니다.");
    const ids = [...new Set([user.ownerId, ...meeting.attendees])];
    const peopleResult = await createServiceSupabase().from("os_profiles").select("id,display_name,role,member_kind").eq("is_active", true).in("id", ids);
    if (peopleResult.error) throw new ApiError(503, "MEETING_READ_FAILED", "회의 참석자를 불러오지 못했습니다.");
    const people = (peopleResult.data ?? []).map(row => ({ ...row, can_approve: false })) as Person[];
    return NextResponse.json({ meeting, people, actor }, { headers: { "Cache-Control": "private, no-store" } });
  } catch (error) {
    return apiErrorResponse(error);
  }
}
