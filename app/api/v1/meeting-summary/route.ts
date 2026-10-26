import { NextResponse } from "next/server";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { summarizeMeetingText } from "@/lib/server/meeting-summary";
import { createServiceSupabase } from "@/lib/supabase/server";
import { teamBusiness } from "@/lib/team/business";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

export async function POST(request: Request) {
  try {
    await authenticateRequest(request);
    const body = await parseJson(request) as { transcript?: unknown; meetingDate?: unknown; business?: unknown };
    const transcript = typeof body.transcript === "string" ? body.transcript.trim() : "";
    if (transcript.length < 20 || transcript.length > 200_000) throw new ApiError(400, "INVALID_TRANSCRIPT", "회의 원문은 20자 이상 20만자 이하로 입력해 주세요.");
    const meetingDate = typeof body.meetingDate === "string" ? body.meetingDate : undefined;
    const business = typeof body.business === "string" ? teamBusiness(body.business)?.label : undefined;
    // Names let the AI fill an assignee only with someone who actually works here.
    const { data: people } = await createServiceSupabase().from("os_profiles").select("display_name").eq("is_active", true).eq("member_kind", "staff").limit(100);
    return NextResponse.json(await summarizeMeetingText(transcript, meetingDate, { business, people: (people ?? []).map(row => String(row.display_name ?? "")).filter(Boolean), strict: true }));
  } catch (error) { return apiErrorResponse(error); }
}
