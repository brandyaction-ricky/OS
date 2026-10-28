import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { createUtmLink, listUtmLinks, readUtmLink, syncUtmLedger, utmActor, utmLinkSchema } from "@/lib/server/utm-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PRIVATE = { headers: { "cache-control": "private, no-store" } };

/** The company link ledger: every staff member sees all links. */
export async function GET(request: Request) {
  try {
    await utmActor(request);
    return NextResponse.json({ items: await listUtmLinks() }, PRIVATE);
  } catch (error) { return apiErrorResponse(error); }
}

/** Saves one UTM link (the same requestId gives back the same row), then rebuilds the 링크 대장 document. */
export async function POST(request: Request) {
  try {
    const actor = await utmActor(request);
    const { link } = await createUtmLink(utmLinkSchema.parse(await parseJson(request, 12_000)), actor);
    const ledgerSaved = link.ledger_status === "saved" || await syncUtmLedger(actor.id);
    return NextResponse.json({ link: await readUtmLink(link.id), ledgerSaved }, PRIVATE);
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "UTM_LINK_INVALID", "브랜드·원본 주소·사용처·필수 선택값 3개를 모두 넣어 주세요."));
    return apiErrorResponse(error);
  }
}
