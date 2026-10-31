import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { youtubeActor } from "@/lib/server/youtube-process";
import { endscreenCardSchema, readEndscreenCard, saveEndscreenCard } from "@/lib/server/youtube-endscreen-card";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };

/** 최종 화면 진단 카드 (로건 요청 10/30): read by the 업로드 screen, kept on 링크관리. */
export async function GET(request: Request) {
  try {
    await youtubeActor(request);
    return NextResponse.json(await readEndscreenCard(), { headers });
  } catch (error) { return apiErrorResponse(error); }
}

export async function PUT(request: Request) {
  try {
    const actor = await youtubeActor(request);
    return NextResponse.json(await saveEndscreenCard(actor, endscreenCardSchema.parse(await parseJson(request, 600_000))), { headers });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "ENDSCREEN_CARD_INVALID", "진단 카드 내용을 확인해 주세요. 이미지는 300KB 이하 PNG · JPG예요."));
    return apiErrorResponse(error);
  }
}
