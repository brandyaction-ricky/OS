import { NextResponse } from "next/server";
import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse, parseJson } from "@/lib/http";
import { deleteUtmLink, readUtmLink, syncUtmLedger, updateUtmLink, utmActor, utmLinkUpdateSchema } from "@/lib/server/utm-links";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const PRIVATE = { headers: { "cache-control": "private, no-store" } };

/** Fixes a saved link (notes, or also its destination and UTM values; same id, same short link), then rebuilds the 링크 대장 document. */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await utmActor(request);
    const { id } = await params;
    const link = await updateUtmLink(id, utmLinkUpdateSchema.parse(await parseJson(request, 12_000)));
    const ledgerSaved = await syncUtmLedger(actor.id);
    return NextResponse.json({ link: await readUtmLink(link.id), ledgerSaved }, PRIVATE);
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "UTM_LINK_INVALID", "링크 사용처를 넣어 주세요. 메모는 대상·위치 200자, 기타 500자까지예요."));
    return apiErrorResponse(error);
  }
}

/** Deletes a link (its short link stops opening), then rebuilds the 링크 대장 document; its earlier text stays in the document's versions. */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await utmActor(request);
    const { id } = await params;
    const { expectedUpdatedAt } = z.object({ expectedUpdatedAt: z.string().min(1).max(64) }).strict().parse(await parseJson(request, 2_000));
    await deleteUtmLink(id, expectedUpdatedAt, actor);
    return NextResponse.json({ deleted: true, ledgerSaved: await syncUtmLedger(actor.id) }, PRIVATE);
  } catch (error) {
    if (error instanceof ZodError) return apiErrorResponse(new ApiError(400, "UTM_LINK_INVALID", "링크 목록을 새로 불러온 뒤 다시 지워 주세요."));
    return apiErrorResponse(error);
  }
}
