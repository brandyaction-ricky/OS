import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { createUtmOption, listUtmOptions, utmActor, utmOptionSchema } from "@/lib/server/utm-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PRIVATE = { headers: { "cache-control": "private, no-store" } };

/** 링크관리 shared UTM choices: every staff member lists and adds; nothing waits for approval (기능요청서 2026-10-28). */
export async function GET(request: Request) {
  try {
    const actor = await utmActor(request);
    return NextResponse.json({ items: await listUtmOptions(), canManage: actor.isAdmin }, PRIVATE);
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await utmActor(request);
    return NextResponse.json(await createUtmOption(utmOptionSchema.parse(await parseJson(request, 4_000)), actor), PRIVATE);
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "UTM_OPTION_INVALID", "표시 이름과 URL 코드를 넣어 주세요."));
    return apiErrorResponse(error);
  }
}
