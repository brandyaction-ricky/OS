import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { createServiceSupabase } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const service = createServiceSupabase();
    const limit = Math.min(Math.max(Number(new URL(request.url).searchParams.get("limit") ?? 100), 1), 200);
    let events = service.from("os_record_events")
      .select("id,record_id,actor_id,event_type,from_status,to_status,changed_fields,note,created_at,os_records(title,record_type)")
      .order("created_at", { ascending: false }).limit(limit);
    if (actor.role !== "admin") events = events.eq("actor_id", actor.id);
    const { data, error } = await events;
    if (error) throw new ApiError(400, "AUDIT_LIST_FAILED", "감사 로그를 불러오지 못했습니다.", error.message);
    return NextResponse.json({ events: data ?? [] });
  } catch (error) { return apiErrorResponse(error); }
}
