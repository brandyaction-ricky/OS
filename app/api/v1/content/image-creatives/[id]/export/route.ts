import { z, ZodError } from "zod";
import { ApiError, apiErrorResponse } from "@/lib/http";
import { authenticateRequest } from "@/lib/server/auth";
import { exportImageCreative, signedImageExport, imageError, imageRecord } from "@/lib/server/image-creatives";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120;
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const actor = await authenticateRequest(request), id = z.string().uuid().parse((await params).id);
    const input = z.object({ variantId: z.string().max(100).optional(), batchId: z.string().max(100).optional() }).strict()
      .refine(value => Boolean(value.variantId) !== Boolean(value.batchId)).parse(Object.fromEntries(new URL(request.url).searchParams));
    const record = await imageRecord(actor.supabase, actor.ownerId, id);
    const file = await exportImageCreative(record, input);
    return Response.json(await signedImageExport(record, file), { headers: { "cache-control": "private, no-store" } });
  } catch (error) { return apiErrorResponse(error instanceof ZodError ? new ApiError(400, "IMAGE_EXPORT_INVALID", "소재 또는 묶음 하나를 골라 주세요.") : imageError(error)); }
}
