import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { addArchiveToMeeting, addArchiveToPlan, archiveChangeSchema, archiveKeepSchema, archiveMeetingSchema, archivePlanSchema, changeArchive, keepArchiveVideo, listArchive, planVideos,
  upcomingMeetings } from "@/lib/server/content-archive";

// 아카이브 (수정 요청 2026-11-13, 2단계): the Telegram reference cards, and their 상태 · 주제.
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store" };

export async function GET(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    // 회의 안건으로: the meetings a card can be added to; 썸네일 참고로: the videos in 기획안.
    const params = new URL(request.url).searchParams;
    return NextResponse.json(params.get("meetings") ? await upcomingMeetings(actor) : params.get("videos") ? await planVideos(actor) : await listArchive(actor), { headers });
  }
  catch (error) { return apiErrorResponse(error); }
}

export async function PATCH(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    return NextResponse.json(await changeArchive(actor, archiveChangeSchema.parse(await parseJson(request, 4_000))), { headers });
  } catch (error) {
    return apiErrorResponse(error instanceof ZodError ? new ApiError(400, "INVALID_ARCHIVE_CHANGE", "바꿀 상태나 주제를 확인해 주세요.") : error);
  }
}

/** 3단계: a YouTube video card into 주제 찾기 › 담아 둔 영상 (the card turns 주제 후보) or a 기획안's 참고 영상, or a card onto a meeting's 안건. */
export async function POST(request: Request) {
  try {
    const actor = await authenticateRequest(request);
    const body = await parseJson(request, 1_000) as Record<string, unknown>;
    if (body && "projectId" in body) return NextResponse.json(await addArchiveToPlan(actor, archivePlanSchema.parse(body)), { headers });
    if (body && "meetingId" in body) return NextResponse.json(await addArchiveToMeeting(actor, archiveMeetingSchema.parse(body)), { headers });
    return NextResponse.json(await keepArchiveVideo(actor, archiveKeepSchema.parse(body)), { headers });
  } catch (error) {
    return apiErrorResponse(error instanceof ZodError ? new ApiError(400, "INVALID_ARCHIVE_KEEP", "담을 카드를 확인해 주세요.") : error);
  }
}
