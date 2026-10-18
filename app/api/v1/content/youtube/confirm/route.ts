import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { confirmTabSchema, listConfirmations, youtubeActor } from "@/lib/server/youtube-process";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 대표 메뉴 › 컨펌: 컨펌 대기 · 내가 처리한 것 · 보류함 (approver only). */
export async function GET(request: Request) {
  try {
    const actor = await youtubeActor(request);
    const tab = confirmTabSchema.parse(new URL(request.url).searchParams.get("tab") ?? "wait");
    return NextResponse.json({ items: await listConfirmations(actor, tab) }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "INVALID_CONFIRM_TAB", "컨펌 탭을 확인해 주세요."));
    return apiErrorResponse(error);
  }
}
