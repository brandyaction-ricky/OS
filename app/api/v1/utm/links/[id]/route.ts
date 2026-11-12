import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { readUtmLink, syncUtmLedger, updateUtmLink, utmActor, utmLinkUpdateSchema } from "@/lib/server/utm-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Fixes a saved link's 사용처 and 관리 메모 (no new link, same short link), then rebuilds the 링크 대장 document. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await utmActor(request);
    const { id } = await params;
    const link = await updateUtmLink(id, utmLinkUpdateSchema.parse(await parseJson(request, 8_000)));
    const ledgerSaved = await syncUtmLedger(actor.id);
    return NextResponse.json({ link: await readUtmLink(link.id), ledgerSaved }, { headers: { "cache-control": "private, no-store" } });
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "UTM_LINK_INVALID", "링크 사용처를 넣어 주세요. 메모는 대상·위치 200자, 기타 500자까지예요."));
    return apiErrorResponse(error);
  }
}
