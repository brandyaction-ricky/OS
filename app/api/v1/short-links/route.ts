import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { listMyinShortLinks, makeMyinShortLink, shortLinkSchema } from "@/lib/server/myin-short-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** 마이인 단축 링크 (owner decision 2026-10-26): any staff member shortens any https address; the newest 50 are listed. */
async function person(request: Request) {
  const actor = await authenticateRequest(request);
  if (actor.type !== "user") throw new ApiError(403, "PEOPLE_ONLY", "단축 링크는 직원 계정으로 만들어요.");
  return actor;
}

export async function GET(request: Request) {
  try {
    await person(request);
    return NextResponse.json({ items: await listMyinShortLinks() }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await person(request);
    const link = await makeMyinShortLink(shortLinkSchema.parse(await parseJson(request, 8_000)), actor.id);
    return NextResponse.json(link, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "SHORT_LINK_INVALID", "https://로 시작하는 주소를 넣어 주세요."));
    return apiErrorResponse(error);
  }
}
