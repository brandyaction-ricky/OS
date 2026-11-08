import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { utmActor } from "@/lib/server/utm-links";
import { changeEduLink, eduLinkCreateSchema, eduLinkPatchSchema, listEduLinks, makeEduLink } from "@/lib/server/edu-short-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "cache-control": "private, no-store" };
// The schema's own Korean messages (https only, 주소 끝부분 rule) are shown; zod's English ones become one plain line.
const invalid = (error: unknown) => {
  if (!(error instanceof ZodError)) return apiErrorResponse(error);
  const said = error.issues[0]?.message ?? "";
  return apiErrorResponse(new ApiError(400, "EDU_LINK_INVALID", /[가-힣]/.test(said) ? said : "이름·채널·https:// 도착 주소를 확인해 주세요."));
};

/** 채널/링크 관리 › 에듀 고정 링크: staff (not partners or AI keys) list, make and change brandyaction-edu.com/go links. */
export async function GET(request: Request) {
  try {
    await utmActor(request);
    return NextResponse.json({ items: await listEduLinks() }, { headers });
  } catch (error) { return apiErrorResponse(error); }
}

export async function POST(request: Request) {
  try {
    const actor = await utmActor(request);
    return NextResponse.json(await makeEduLink(eduLinkCreateSchema.parse(await parseJson(request, 8_000)), actor.id), { headers });
  } catch (error) { return invalid(error); }
}

export async function PATCH(request: Request) {
  try {
    await utmActor(request);
    return NextResponse.json(await changeEduLink(eduLinkPatchSchema.parse(await parseJson(request, 8_000))), { headers });
  } catch (error) { return invalid(error); }
}
