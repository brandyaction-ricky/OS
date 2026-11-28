import { z } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { AD_REFERENCE_MAX } from "@/lib/ad-source-studio";
import { authenticateRequest } from "@/lib/server/auth";
import { adSourceBundle, adSourceError, readAdBytes, uploadAdReference } from "@/lib/server/ad-source-studio";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateRequest(request), id = z.string().uuid().parse((await params).id);
    const bytes = await readAdBytes(request, AD_REFERENCE_MAX + 16_384);
    const form = await new Response(new Uint8Array(bytes), { headers: { "content-type": request.headers.get("content-type") ?? "" } }).formData();
    const file = form.get("file"), version = z.coerce.number().int().positive().parse(form.get("version"));
    if (!(file instanceof File)) throw new ApiError(422, "AD_SOURCE_FILE", "참고 이미지를 선택해 주세요.");
    return Response.json(await adSourceBundle(await uploadAdReference(actor, id, version, file)), { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(adSourceError(error)); }
}
